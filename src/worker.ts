import { handle } from '@astrojs/cloudflare/handler';
import { DurableObject } from 'cloudflare:workers';
import { sourceFor, layers, keepMissing, stationKeys, type Frame, type Source, type Station } from './lib/sources';
import { regionalCharts, type JadralciRun } from './lib/jadralci';

// Browsers may keep a response until the server's next upstream check is due; nothing newer exists before then.
const cacheUntil = (nextCheck: number) => ({'Cache-Control':`private, max-age=${Math.max(0, Math.floor((nextCheck - Date.now()) / 1000))}`});
// Next checks fall on clock boundaries of the interval (10-minute sources at :00, :10, :20 …), so the
// station listings come due together and a browser needs one request per interval, not one per source.
// Never sooner than half an interval after a check, so providers are not asked much more often than set.
const nextDue = (now: number, interval: number) => Math.ceil((now + interval * 500) / (interval * 1000)) * interval * 1000;
const view = (entry: Snapshot) => ({data:entry.data, fetchedAt:entry.fetchedAt, checkedAt:entry.checkedAt, nextCheck:entry.nextCheck, error:entry.error});
interface Snapshot {
  data: unknown; fetchedAt: number | null; checkedAt: number; nextCheck: number;
  error: string | null; failures: number; etag?: string; modified?: string; contentType?: string;
}
export class SourceCache extends DurableObject<Env> {
  private pending = new Map<string, Promise<Snapshot>>();
  // Dated images (one key per model run/frame) are never reused once a newer run exists.
  async alarm(): Promise<void> {
    const cutoff = Date.now() - 2*86400000;
    for (const prefix of ['point:', 'frame:']) {
      const entries = await this.ctx.storage.list<Snapshot>({prefix});
      const old = [...entries].filter(([,entry]) => entry.checkedAt < cutoff).map(([key]) => key);
      for (let i = 0; i < old.length; i += 128) await this.ctx.storage.delete(old.slice(i, i+128));
    }
  }
  async fetch(request: Request): Promise<Response> {
    // Cleanup runs at most daily, and only while the app is being used.
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 86400000);
    const key = new URL(request.url).searchParams.get('key') || '';
    // All station listings in one request; each provider is still checked on its own schedule.
    if (key === 'stations') {
      const entries = await Promise.all(stationKeys.map(k => this.cached(k, sourceFor(k)!)));
      const nextCheck = Math.min(...entries.map(entry => entry.nextCheck));
      return Response.json({sources:Object.fromEntries(stationKeys.map((k, i) => [k, view(entries[i])])), nextCheck}, {headers:cacheUntil(nextCheck)});
    }
    let source = sourceFor(key);
    if (!source) return new Response('Unknown source', {status:404});
    // History is only fetched for stations in the cached listing; Skytech dates its graph from it.
    if (key.startsWith('history:')) {
      const [,kind,id] = key.split(':');
      const list = await this.ctx.storage.get<Snapshot>(kind);
      const station = Array.isArray(list?.data) ? (list.data as Station[]).find(s => s.id === `${kind}-${id}`) : undefined;
      if (!station) return new Response('Load stations first', {status:404});
      source = sourceFor(key, station.observedAt ?? undefined)!;
    }
    if (key.startsWith('frame:')) {
      const lists = await this.ctx.storage.get<Snapshot>(Object.keys(layers).map(id => `zaladin:${id}`));
      const known = [...lists.values()].some(list => Array.isArray(list.data) && (list.data as Frame[]).some(frame => frame.url === source.url));
      if (!known) return new Response('Load a forecast layer first', {status:404});
    }
    if (key.startsWith('point:')) {
      const manifest=await this.ctx.storage.get<Snapshot>('jadralci');
      const region=key.split(':')[3];
      const known=manifest?.data && regionalCharts(manifest.data as JadralciRun,region).some(chart=>chart.key===key);
      if (!known) return new Response('Load the current Jadralci run first', {status:404});
    }
    const entry = await this.cached(key, source);
    if (source.image) {
      if (!(entry.data instanceof ArrayBuffer)) return new Response('Image unavailable', {status:503,headers:{'Cache-Control':'no-store'}});
      return new Response(entry.data, {headers:{
        'Content-Type':entry.contentType || 'image/png', ...cacheUntil(entry.nextCheck),
        'X-Fetched-At':String(entry.fetchedAt), 'X-Source-Stale':String(Boolean(entry.error)),
        'Access-Control-Expose-Headers':'X-Fetched-At, X-Source-Stale',
      }});
    }
    return Response.json(view(entry), {headers:cacheUntil(entry.nextCheck)});
  }
  // Concurrent requests for a source share one in-flight check.
  private cached(key: string, source: Source): Promise<Snapshot> {
    let task = this.pending.get(key);
    if (!task) {
      task = this.snapshot(key, source);
      this.pending.set(key, task);
      void task.finally(() => this.pending.delete(key)).catch(() => {});
    }
    return task;
  }
  private async snapshot(key: string, source: Source): Promise<Snapshot> {
    const previous = await this.ctx.storage.get<Snapshot>(key);
    if (previous && Date.now() < previous.nextCheck) return previous;
    const now=Date.now();
    let retryAt=0;
    try {
      if (source.load) {
        const loaded=await source.load();
        const data=source.stations ? keepMissing(loaded as Station[],previous?.data) : loaded;
        const entry:Snapshot={data,fetchedAt:now,checkedAt:now,nextCheck:nextDue(now,source.interval),error:null,failures:0};
        await this.ctx.storage.put(key,entry);
        return entry;
      }
      const headers=new Headers(source.init?.headers);
      headers.set('User-Agent','Paraglajzer/0.1 (shared paragliding weather cache)');
      if (previous?.etag) headers.set('If-None-Match',previous.etag);
      if (previous?.modified) headers.set('If-Modified-Since',previous.modified);
      // Skytech's table takes 4–10 s to arrive, so allow 20 s.
      const response=await fetch(source.url,{...source.init,headers,signal:AbortSignal.timeout(20000)});
      let entry: Snapshot;
      if (response.status===304 && previous?.fetchedAt) {
        entry={...previous, checkedAt:now, nextCheck:nextDue(now,source.interval), failures:0,error:null};
      } else {
        if (!response.ok) {
          const retry=response.headers.get('Retry-After');
          if (retry) retryAt=/^\d+$/.test(retry) ? now+Number(retry)*1000 : Date.parse(retry) || 0;
          throw new Error(`HTTP ${response.status}`);
        }
        const contentType=response.headers.get('Content-Type') || '';
        if (source.image && !contentType.startsWith('image/')) throw new Error('Invalid image response');
        const parsed=source.image ? await response.arrayBuffer() : source.parse!(await response.text());
        const data=source.stations ? keepMissing(parsed as Station[],previous?.data) : parsed;
        entry={data,fetchedAt:now,checkedAt:now,nextCheck:nextDue(now,source.interval),error:null,failures:0,
          etag:response.headers.get('ETag') || undefined,modified:response.headers.get('Last-Modified') || undefined,contentType};
      }
      await this.ctx.storage.put(key,entry);
      return entry;
    } catch (error) {
      const failures=(previous?.failures || 0)+1;
      const entry: Snapshot={...previous, data:previous?.data ?? null,fetchedAt:previous?.fetchedAt ?? null, checkedAt:now,
        // Retry after 1, 2, 4, 8 … minutes (at most 6 h): a one-off slow response clears quickly, a provider
        // that is down is still asked rarely. Retries only happen while someone has the app open.
        nextCheck:Math.max(retryAt,now+Math.min(60*2**(failures-1),21600)*1000),
        failures,error:error instanceof Error ? error.message : 'Source unavailable'};
      await this.ctx.storage.put(key,entry);
      return entry;
    }
  }
}
export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
    if (url.pathname==='/api/source') {
      const key=url.searchParams.get('key') || '';
      if (key!=='stations' && !sourceFor(key)) return new Response('Unknown source',{status:404});
      if (request.method!=='GET') return new Response('Method not allowed',{status:405,headers:{Allow:'GET'}});
      const stub=env.SOURCES.get(env.SOURCES.idFromName('shared-v1'));
      return stub.fetch(`https://cache.internal/?key=${encodeURIComponent(key)}`);
    }
    return handle(request,env,ctx);
  },
} satisfies ExportedHandler<Env>;
