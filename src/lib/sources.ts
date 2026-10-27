import { XMLParser } from 'fast-xml-parser';
import { discoverJadralci, regionalImage, chartRegions, nearestRegion } from './jadralci.ts';
import { parseVetrHistory, chronological, speed, type WindSample } from './history.ts';
import { locations } from './sites.ts';
import { inGorenjska } from './gorenjska.ts';

export const ARSO = 'https://meteo.arso.gov.si';
export const regions = { LES: 'Gorenjska', NGO: 'Primorska', LJU: 'Osrednja', NMO: 'Dolenjska', CEL: 'Štajerska', MSO: 'Pomurska' } as const;
export const layers = { '1': 'Padavine', '2': 'Veter · 1500 m', '3': 'Veter · 750 m', '4': 'Temperatura', '5': 'Veter · 10 m', '6': 'Veter · Osrednja', '7': 'Veter · JZ', '8': 'Veter · JV', '9': 'Veter · SZ', '10': 'Veter · SV' } as const;
export interface Station {
  id: string; name: string; region: string; source: 'vetr' | 'skytech' | 'arso' | 'luftar'; url: string;
  avg: number | null; gust: number | null; direction: string; observedAt: string | null;
  interval: number; note: string; location: [number, number] | null;
}
export interface Frame { url: string; run: string; validAt: string; }
export interface Source { url: string; interval: number; load?: () => Promise<unknown>; init?: RequestInit; parse?: (body: string) => unknown; image?: boolean; stations?: boolean; }
// ARSO sometimes publishes a partial file mid-update (seen with 23 and 70 of ~100 stations), and a Luftar
// file can fail on its own. So a station missing from a new listing keeps its previous reading while that
// reading is under 2 h old; it then shows as stale instead of vanishing until the next check.
export function keepMissing(stations: Station[], previous: unknown, now = Date.now()): Station[] {
  if (!Array.isArray(previous)) return stations;
  const ids = new Set(stations.map(s => s.id));
  // Only stations inside the covered area: an older cached listing may still hold all of Slovenia.
  return [...stations, ...(previous as Station[]).filter(s => !ids.has(s.id) && now - Date.parse(s.observedAt ?? '') < 2 * 3600000
    && s.location !== null && inGorenjska(s.location))];
}
export function plain(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&deg;/g, '°').replace(/\s+/g, ' ').trim();
}
function number(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}
export function parseVetr(html: string): Station[] {
  const match = html.match(/const data\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error('Station data missing');
  const entries = JSON.parse(match[1]);
  if (!Array.isArray(entries) || !entries.length) throw new Error('Empty station data');
  return entries.filter(e => e.station?.active).map(e => ({
    id: `vetr-${e.station.name}`, name: String(e.station.full_name || e.station.name), region: 'Gorenjska', source: 'vetr',
    url: `https://vetr.si/${encodeURIComponent(e.station.name)}`, avg: number(e.windData?.avg), gust: number(e.windData?.max),
    direction: ['S','SV','V','JV','J','JZ','Z','SZ'][e.windData?.dir] || '—',
    observedAt: e.windData?.timestamp || null, interval: number(e.prefsData?.prefs?.send_data_interval_min) || 10,
    note: plain(String(e.station.message || '')),
    location: coordinates(e.station.location) ?? locations[`vetr-${e.station.name}`] ?? null,
  }));
}
function coordinates(location: {lat?: unknown; lon?: unknown} | undefined): [number, number] | null {
  const lat = number(location?.lat), lon = number(location?.lon);
  return lat === null || lon === null ? null : [lat, lon];
}
// Skytech publishes local Slovenian wall-clock times, without an offset.
export function ljubljanaTime(text: string): string | null {
  const m = text.match(/(\d{2}):(\d{2})\s+(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? localTime(Date.UTC(+m[5], +m[4]-1, +m[3], +m[1], +m[2])) : null;
}
// Takes a Ljubljana wall-clock time written as if it were UTC and returns the real instant.
// Built once: creating an Intl.DateTimeFormat costs far more than using it, and this runs per reading.
const ljubljanaClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Ljubljana', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
function localTime(target: number): string {
  let utc = target;
  for (let i=0; i<3; i++) {
    const p = Object.fromEntries(ljubljanaClock.formatToParts(utc).map(p => [p.type,p.value]));
    const local = Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);
    utc += target-local;
  }
  return new Date(utc).toISOString();
}
// Skytech stations left out everywhere: Kriška gora has been "na servisu" (offline) since 2025;
// the Luftar Kriška gora station covers the site.
const hiddenSkytech = new Set(['ef075856fd59824786203959f9c8c45c']);
export function parseSkytech(html: string): Station[] {
  let region = ''; const stations: Station[] = [];
  for (const chunk of html.split(/(?=<h1>)/)) {
    region = plain(chunk.match(/<h1>(.*?)<\/h1>/s)?.[1] || region);
    for (const row of chunk.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m => plain(m[1]));
      const id = row[1].match(/show\('graf','([a-f0-9]+)'\)/)?.[1];
      if (cells.length !== 6 || !id || hiddenSkytech.has(id)) continue;
      stations.push({ id: `skytech-${id}`, name: cells[0], region, source: 'skytech', url: 'https://skytech.si/', avg: number(cells[1]), gust: number(cells[2]), direction: cells[3], observedAt: ljubljanaTime(cells[5]), interval: 5, note: '', location: locations[`skytech-${id}`] ?? null });
    }
  }
  if (!stations.length) throw new Error('Station table missing');
  return stations;
}
// Skytech graphs give only HH:MM. The newest reading is dated from `anchor` (the table's
// observation time) and each earlier reading steps back a day whenever the clock goes backwards.
export function parseSkytechHistory(html: string, anchor: string): WindSample[] {
  const [speedPart, directionPart = ''] = html.split("$('#dir')");
  const times = [...(speedPart.match(/categories:\s*\[([^\]]*)\]/)?.[1] || '').matchAll(/'(\d{2}):(\d{2})'/g)].map(m => +m[1]*60 + +m[2]);
  const series = (part: string) => [...part.matchAll(/data:\s*\[([^\]]*)\]/g)].map(m => m[1].split(',').map(v => v.trim()).filter(Boolean).map(Number));
  const [avg = [], gust = []] = series(speedPart), [direction = []] = series(directionPart);
  if (!times.length) throw new Error('Wind history missing');
  const anchorTime = Number.isFinite(Date.parse(anchor)) ? Date.parse(anchor) : Date.now();
  const p = Object.fromEntries(ljubljanaClock.formatToParts(anchorTime).map(p => [p.type,p.value]));
  const dayMs = 86400000;
  let day = Date.UTC(+p.year, +p.month-1, +p.day);
  const at = (index: number) => localTime(day + times[index]*60000);
  if (Date.parse(at(times.length-1)) > anchorTime + 6*3600000) day -= dayMs;
  const samples: WindSample[] = [];
  for (let i = times.length-1; i >= 0; i--) {
    if (i < times.length-1 && times[i] > times[i+1]) day -= dayMs;
    // Direction is an index into Skytech's axis labels: SZ, Z, JZ, J, JV, V, SV, S.
    const d = direction[i];
    samples.push({ timestamp: at(i), avg: speed(avg[i]), gust: speed(gust[i]), direction: Number.isInteger(d) && d >= 0 && d < 8 ? ((7-d)*45) % 360 : null });
  }
  return chronological(samples);
}
// Nearest of the 8 compass labels used by vetr and Skytech, for sources that give degrees.
const compass8 = (degrees: number) => ['S','SV','V','JV','J','JZ','Z','SZ'][Math.round(degrees / 45) % 8];
// ARSO automatic stations (XML, one <metData> per station or per history step). Read with regexes,
// not a full XML parse, to keep Worker CPU low on the 0.8–2.5 MB files.
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? '';
function arsoTime(block: string): string | null {
  const time = Date.parse(tag(block, 'tsValid_issued_RFC822'));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
// Keeps only stations that report wind. Direction is rounded to 8 points like the other sources.
export function parseArso(xml: string): Station[] {
  const blocks = xml.split('<metData>').slice(1);
  if (!blocks.length) throw new Error('Station data missing');
  const stations = blocks.flatMap((block): Station[] => {
    const id = tag(block, 'domain_meteosiId'), avg = number(tag(block, 'ffavg_val')), dir = number(tag(block, 'ddavg_val'));
    if (!/^[A-Z0-9_-]{1,40}$/.test(id) || avg === null) return [];
    const location = coordinates({ lat: tag(block, 'domain_lat'), lon: tag(block, 'domain_lon') });
    return [{
      id: `arso-${id}`, name: plain(tag(block, 'domain_longTitle')), region: location ? chartRegions[nearestRegion(location)] : '',
      source: 'arso', url: 'https://meteo.arso.gov.si/met/sl/app/webmet/', avg, gust: number(tag(block, 'ffmax_val')),
      direction: dir === null ? '—' : compass8(dir),
      // Some stations report every 10 minutes, others every 30.
      observedAt: arsoTime(block), interval: 30, note: '', location,
    }];
  });
  if (!stations.length) throw new Error('No wind stations');
  return stations;
}
// History is newest first, in 10-minute steps over 48 h. Only the 6 h before the newest reading are kept.
export function parseArsoHistory(xml: string): WindSample[] {
  const samples: WindSample[] = [];
  let newest = 0;
  for (const block of xml.split('<metData>').slice(1)) {
    const timestamp = arsoTime(block);
    if (!timestamp) continue;
    newest ||= Date.parse(timestamp);
    if (Date.parse(timestamp) < newest - 6 * 3600000) break;
    const dir = number(tag(block, 'ddavg_val'));
    samples.push({ timestamp, avg: speed(number(tag(block, 'ffavg_val'))), gust: speed(number(tag(block, 'ffmax_val'))), direction: dir === null || dir < 0 || dir > 360 ? null : dir % 360 });
  }
  return chronological(samples);
}
// Luftar (Tržič paragliding club) stations: one JSON file each, about 6 h of 10-minute readings,
// timestamps in Ljubljana wall-clock time without an offset. Positions are approximate.
export const luftarStations = {
  kriska: { name: 'Kriška gora', file: 'wsDataKriskaHiCharts', location: [46.3517, 14.3334] },
  sebenje: { name: 'Sebenje (Križe)', file: 'wsDataSebenjeHiCharts', location: [46.3310, 14.3000] },
} as const;
const luftarUrl = (id: keyof typeof luftarStations) => `https://www.luftar.si/data/${luftarStations[id].file}.json`;
export function parseLuftarHistory(body: string): WindSample[] {
  const rows: unknown = JSON.parse(body);
  if (!Array.isArray(rows)) throw new Error('Invalid Luftar data');
  return chronological(rows.flatMap((row): WindSample[] => {
    const m = String(row?.timestamp ?? '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return [];
    const dir = number(row.wind_direction);
    return [{ timestamp: localTime(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5])), avg: speed(row.wind_speed), gust: speed(row.wind_speed_max),
      direction: dir === null || dir < 0 || dir > 360 ? null : dir % 360 }];
  }));
}
// The listing is the newest reading of each station; a station that fails is left out for this check.
async function loadLuftar(): Promise<Station[]> {
  const stations = await Promise.all((Object.keys(luftarStations) as (keyof typeof luftarStations)[]).map(async (id): Promise<Station | null> => {
    try {
      const response = await fetch(luftarUrl(id), { headers: { 'User-Agent': 'Paraglajzer/0.1 (shared paragliding weather cache)' }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) return null;
      const latest = parseLuftarHistory(await response.text()).at(-1)!;
      const site = luftarStations[id];
      return { id: `luftar-${id}`, name: site.name, region: 'Gorenjska', source: 'luftar', url: 'https://www.luftar.si/', avg: latest.avg, gust: latest.gust,
        direction: latest.direction === null ? '—' : compass8(latest.direction), observedAt: latest.timestamp, interval: 10, note: '', location: [...site.location] };
    } catch { return null; }
  }));
  const found = stations.filter(station => station !== null);
  if (!found.length) throw new Error('Luftar unavailable');
  return found;
}
export function parseFrames(html: string): Frame[] {
  const frames = [...html.matchAll(/src=["'](https?:\/\/meteo\.arso\.gov\.si\/uploads\/probase\/www\/model\/aladin\/field\/as_(\d{8})-(\d{4})_[^"']+_(\d{3})\.png)["']/g)].map(m => {
    const d=m[2], h=m[3]; const run = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${h.slice(0,2)}:${h.slice(2)}:00Z`;
    return { url:m[1].replace('http:', 'https:'), run, validAt:new Date(Date.parse(run)+Number(m[4])*3600000).toISOString() };
  });
  if (!frames.length) throw new Error('Forecast frames missing');
  const latest = frames.map(f => f.run).sort().at(-1);
  return frames.filter(f => f.run === latest).sort((a,b) => a.validAt.localeCompare(b.validAt));
}
export function parseThermals(xml: string) {
  const channel = new XMLParser().parse(xml)?.rss?.channel;
  if (!channel?.item) throw new Error('Thermal bulletin missing');
  const items = Array.isArray(channel.item) ? channel.item : [channel.item];
  return { issuedAt: String(channel.pubDate || ''), items: items.map((item: {title: string; description: string}) => {
    const cells=[...item.description.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m=>plain(m[1]));
    const maxLift=cells.length>=6 ? number(cells.at(-2)) : null;
    return { title:plain(item.title), text:plain(item.description), maxLift };
  }) };
}
// For now only stations inside Gorenjska leave the Worker, all labelled Gorenjska. Station history is
// only served for stations in a cached listing, so it is limited to Gorenjska too.
const gorenjska = (stations: Station[]): Station[] =>
  stations.filter(s => s.location !== null && inGorenjska(s.location)).map(s => ({ ...s, region: 'Gorenjska' }));
// Station listings, served together as key 'stations'.
export const stationKeys = ['vetr', 'skytech', 'arso', 'luftar'] as const;
export function sourceFor(key: string, anchor?: string): Source | null {
  if (key === 'jadralci') return { url:ARSO, interval:1800, load:() => discoverJadralci() };
  const point=regionalImage(key);
  if (point) return { url:point.url, interval:86400, image:true };
  const history = key.match(/^history:(vetr|skytech):([a-z0-9_-]{1,40})$/);
  if (history?.[1] === 'vetr') return { url:`https://vetr.si/${history[2]}`, interval:600, parse:parseVetrHistory };
  if (history?.[1] === 'skytech' && /^[a-f0-9]{32}$/.test(history[2])) return { url:'https://skytech.si/skytechsys/data.php', interval:600, init:{method:'POST', body:`c=graf&l=${history[2]}`, headers:{'Content-Type':'application/x-www-form-urlencoded'}}, parse:body => parseSkytechHistory(body, anchor ?? new Date().toISOString()) };
  if (key === 'luftar') return { url:'https://www.luftar.si/', interval:600, stations:true, load:async () => gorenjska(await loadLuftar()) };
  const luftarHistory = key.match(/^history:luftar:(kriska|sebenje)$/);
  if (luftarHistory) return { url:luftarUrl(luftarHistory[1] as keyof typeof luftarStations), interval:600, parse:parseLuftarHistory };
  const arsoHistory = key.match(/^history:arso:([A-Z0-9_-]{1,40})$/);
  if (arsoHistory) return { url:`${ARSO}/uploads/probase/www/observ/surface/text/sl/recent/observationAms_${arsoHistory[1]}history.xml`, interval:600, parse:parseArsoHistory };
  if (key === 'arso') return { url:`${ARSO}/uploads/probase/www/observ/surface/text/sl/observationAms_si_latest.xml`, interval:600, stations:true, parse:body => gorenjska(parseArso(body)) };
  if (key === 'vetr') return { url:'https://vetr.si/', interval:600, stations:true, parse:body => gorenjska(parseVetr(body)) };
  if (key === 'skytech') return { url:'https://skytech.si/skytechsys/data.php', interval:600, init:{method:'POST', body:'c=tabela', headers:{'Content-Type':'application/x-www-form-urlencoded'}}, stations:true, parse:body => gorenjska(parseSkytech(body)) };
  if (key === 'aviation') return { url:`${ARSO}/uploads/probase/www/aviation/fproduct/text/sl/aviation.txt`, interval:600, parse:body => body.replace(/\^/g,'Č').replace(/~/g,'č').replace(/\[/g,'Š').replace(/\{/g,'š').replace(/@/g,'Ž').replace(/`/g,'ž') };
  if (key === 'sounding') return { url:`${ARSO}/uploads/probase/www/aviation/observ/upper/graphic/sigps_ljubljana-bezigrad.png`, interval:1800, image:true };
  if (key === 'radar') return { url:`${ARSO}/uploads/probase/www/observ/radar/si0_zm_si_latest.jpg`, interval:300, image:true };
  const [type,id] = key.split(':');
  if (type==='thermal' && key===`thermal:${id}` && Object.hasOwn(regions,id)) return { url:`${ARSO}/uploads/probase/www/aviation/RSS/termika${id}.xml`, interval:600, parse:parseThermals };
  if (type==='zaladin' && key===`zaladin:${id}` && Object.hasOwn(layers,id)) return { url:`https://zaladin.razor.si/zaladin.php?slika=${id}`, interval:1800, parse:parseFrames };
  // Only allow exact model image paths; never accept an arbitrary upstream URL.
  if (key.startsWith('frame:')) {
    const path=key.slice(6);
    if (/^as_\d{8}-\d{4}_[a-zA-Z0-9_-]+_\d{3}\.png$/.test(path)) return { url:`${ARSO}/uploads/probase/www/model/aladin/field/${path}`, interval:86400, image:true };
  }
  return null;
}
