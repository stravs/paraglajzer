import type { Station } from '../lib/sources';
export interface Snapshot<T> { data:T | null; fetchedAt:number | null; checkedAt:number; nextCheck:number; error:string | null; }
export const sourceLabel={vetr:'vetr.si',skytech:'Skytech',arso:'ARSO',luftar:'Luftar'} as const;
export const $=<T=HTMLElement>(id:string)=>document.getElementById(id) as T;
export const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const date=(value:string|number)=>Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat('sl-SI',{timeZone:'Europe/Ljubljana',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value)) : 'Čas ni znan';
export function read<T>(key:string,fallback:T):T { try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;} }
export function save(key:string,value:unknown) {try{localStorage.setItem(key,JSON.stringify(value));}catch{/* Preferences remain in memory. */}}
export const snapshots=new Map<string,Snapshot<unknown>>();
const pending=new Map<string,Promise<Snapshot<unknown>>>();
// The four station listings arrive together from key 'stations' (one request instead of four);
// each listing is reused until the earliest of their next server checks.
const stationKeys=['vetr','skytech','arso','luftar'];
let stationsDue=0,stationsTask:Promise<void>|null=null;
function loadStations():Promise<void> {
  if(Date.now()<stationsDue)return Promise.resolve();
  stationsTask??=(async()=>{
    try {
      const response=await fetch('/api/source?key=stations',{signal:AbortSignal.timeout(25000)});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const result=await response.json() as {sources:Record<string,Snapshot<unknown>>;nextCheck:number};
      for(const key of stationKeys)if(result.sources[key])snapshots.set(key,result.sources[key]);
      stationsDue=result.nextCheck;
    } finally {stationsTask=null;}
  })();
  return stationsTask;
}
export async function source<T>(key:string):Promise<Snapshot<T>> {
  if(stationKeys.includes(key)) {
    await loadStations();
    const snapshot=snapshots.get(key);
    if(!snapshot)throw new Error('Source unavailable');
    return snapshot as Snapshot<T>;
  }
  const previous=snapshots.get(key);
  if(previous && Date.now()<previous.nextCheck) return previous as Snapshot<T>;
  let task=pending.get(key);
  if(!task) {
    task=(async()=>{
      const response=await fetch(`/api/source?key=${encodeURIComponent(key)}`,{signal:AbortSignal.timeout(25000)});
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot=await response.json() as Snapshot<unknown>;
      snapshots.set(key,snapshot);return snapshot;
    })();
    pending.set(key,task);
    void task.finally(()=>pending.delete(key)).catch(()=>{});
  }
  return task as Promise<Snapshot<T>>;
}
interface CachedImage { url:string; stale:boolean; fetchedAt:number; expires:number; }
const images=new Map<string,CachedImage>();
export async function imageSource(key:string):Promise<CachedImage> {
  const previous=images.get(key);
  if(previous && Date.now()<previous.expires) return previous;
  const response=await fetch(`/api/source?key=${encodeURIComponent(key)}`,{signal:AbortSignal.timeout(25000)});
  if(!response.ok || !response.headers.get('Content-Type')?.startsWith('image/')) throw new Error('Slika ni na voljo');
  const interval=key==='radar'?300:key==='sounding'?1800:86400;
  const result={url:URL.createObjectURL(await response.blob()),stale:response.headers.get('X-Source-Stale')==='true',fetchedAt:Number(response.headers.get('X-Fetched-At')),expires:Date.now()+interval*1000};
  // Keep old URLs alive until navigation, in case they are still displayed.
  objectUrls.push(result.url);images.set(key,result);return result;
}
const objectUrls:string[]=[];
window.addEventListener('pagehide',event=>{if(!event.persisted)objectUrls.forEach(url=>URL.revokeObjectURL(url));});
export function startPolling(update:()=>Promise<unknown>,tick?:()=>void) {
  let busy=false,lastCheck=0;
  // The map page has no header, so no refresh button or status.
  const button=document.getElementById('refresh') as HTMLButtonElement|null,status=document.getElementById('refresh-status');
  async function refresh() {
    if(busy) return;
    busy=true;if(button)button.disabled=true;
    if(status)status.textContent='Nalaganje…';
    try {await update();if(status)status.textContent=`Preverjeno ${date(Date.now())}`;}
    catch {if(status)status.textContent='Napaka pri osveževanju';}
    finally {lastCheck=Date.now();busy=false;if(button)button.disabled=false;}
  }
  button?.addEventListener('click',()=>void refresh());
  setInterval(()=>{if(!document.hidden){tick?.();if(Date.now()-lastCheck>=60000) void refresh();}},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden && Date.now()-lastCheck>=60000) void refresh();});
  void refresh();
}

export function freshness(station:Station) {
  const minutes=(Date.now()-Date.parse(station.observedAt||''))/60000;
  const stale=!Number.isFinite(minutes)||minutes>Math.max(15,station.interval*2.5)||minutes < -5;
  return {stale,label:!Number.isFinite(minutes)?'Čas ni znan':minutes < -5?'Napaka ure':stale?'Zastarelo':`${Math.max(0,Math.floor(minutes))} min`};
}
