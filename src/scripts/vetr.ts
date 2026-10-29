import type { Station } from '../lib/sources';
import type { VetrRaw } from '../lib/vetr-raw';
import { $,escape,source,startPolling } from './weather';

const sectors=['S','SV','V','JV','J','JZ','Z','SZ'];
const time=(ms:number)=>new Intl.DateTimeFormat('sl-SI',{timeZone:'Europe/Ljubljana',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(ms);
const quarter=(ms:number)=>new Intl.DateTimeFormat('sl-SI',{timeZone:'Europe/Ljubljana',hour:'2-digit',minute:'2-digit'}).format(ms);
const ms=(n:number|null|undefined)=>n===null||n===undefined?'—':n.toFixed(1);
const span=(seconds:number)=>seconds<60?`${Math.round(seconds)} s`:`${(seconds/60).toFixed(1).replace('.',',')} min`;
// Home sites first, then the rest by name.
const home=['vetr-peter','vetr-stol','vetr-gozd'];
const order=(a:Station,b:Station)=>(home.indexOf(a.id)+1||9)-(home.indexOf(b.id)+1||9)||a.name.localeCompare(b.name,'sl');

function card(station:Station,raw:VetrRaw|null) {
  const sent=Date.parse(station.sentAt??'');
  // vetr.si's newest window is the 15-min one holding the last reading (~10 s before the send).
  const last=raw?Date.parse(raw.to):sent-10000;
  const label=Math.round(last/900000)*900000,held=(last-(label-450000))/1000;
  const short=held<300;
  // Fewer than 5 min of readings: a station in night power-saving mode records only ~30 s per wake-up.
  const few=!!raw&&raw.samples<60;
  const direction=raw?.direction??null;
  const row=(name:string,vetr:string,ours:string)=>`<tr class="border-t border-zinc-100"><th scope="row" class="py-1 pr-2 text-left font-normal text-zinc-500">${name}</th><td class="py-1 text-right tabular-nums">${vetr}</td><td class="py-1 text-right font-medium tabular-nums">${ours}</td></tr>`;
  return `<article class="rounded border border-zinc-200 p-3">
    <h3 class="font-medium"><a href="${escape(station.url)}" target="_blank" rel="noopener noreferrer" class="underline">${escape(station.name)}</a></h3>
    <p class="mt-0.5 text-xs text-zinc-500">Poslano ${Number.isFinite(sent)?time(sent):'—'}</p>
    <p class="mt-1 text-xs ${short?'text-amber-800':'text-zinc-500'}">vetr.si: okno ${quarter(label)}, v njem ${span(held)} meritev${short?' · nepopolno':''}</p>
    <p class="text-xs ${few?'text-amber-800':'text-zinc-500'}">Izračun: ${raw?`${time(Date.parse(raw.from))}–${time(last)}, ${raw.samples} meritev${few?' · malo meritev (postaja varčuje z energijo)':''}`:'ni podatkov'}</p>
    <table class="mt-2 w-full text-sm">
      <thead class="text-xs text-zinc-500"><tr><th></th><th scope="col" class="text-right font-normal">vetr.si</th><th scope="col" class="text-right font-normal">izračun</th></tr></thead>
      <tbody>
        ${row('Povprečje m/s',ms(station.avg),ms(raw?.avg))}
        ${row('Sunek m/s',ms(station.gust),ms(raw?.gust))}
        ${row('Smer',escape(station.direction),direction===null?'—':`${sectors[Math.round(direction/45)%8]} · ${direction}°`)}
      </tbody>
    </table>
  </article>`;
}
const lastRaw=new Map<string,VetrRaw>();
async function update() {
  try {
    const listing=await source<Station[]>('vetr');
    const stations=(listing.data??[]).filter(station=>station.source==='vetr').sort(order);
    // Ask again as soon as the listing has a newer send than the raw readings (send ~10 s after the last one).
    const raws=await Promise.all(stations.map(station=>{
      const previous=lastRaw.get(station.id),behind=!!previous&&Date.parse(station.sentAt??'')-Date.parse(previous.to)>60000;
      return source<VetrRaw>(`raw:vetr:${station.id.slice(5)}`,behind).then(result=>{if(result.data)lastRaw.set(station.id,result.data);return result.data;},()=>null);
    }));
    $('vetr-compare').innerHTML=stations.map((station,i)=>card(station,raws[i])).join('');
    $('vetr-status').textContent=stations.length?`Osveženo ${time(Date.now())}`:'Ni postaj vetr.si.';
  } catch {$('vetr-status').textContent='Vir ni dosegljiv.';}
}
startPolling(update);
