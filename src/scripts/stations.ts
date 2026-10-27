import type { Station } from '../lib/sources';
import { $,escape,date,freshness,read,save,source,sourceLabel,snapshots,startPolling,type Snapshot } from './weather';
import type { WindSample } from '../lib/history';
import { windCharts,sampleLabel,sampleReading } from './wind-charts';
let stations:Station[]=[];
let peterExpanded=false,historyLoading=false,historyRequest=0;
let peterHistory:Snapshot<WindSample[]>|null=null;
let historyError='',selectedTime:string|null=null;
const chartWidth=()=>document.querySelector('table')?.clientWidth||400;
function historyRow():string {
  const samples=peterHistory?.data||[];
  const index=Math.max(0,selectedTime?samples.findIndex(sample=>sample.timestamp===selectedTime):samples.length-1);
  const latest=samples.at(-1);
  const stale=latest&&Date.now()-Date.parse(latest.timestamp)>25*60000;
  const content=samples.length?`<output id="peter-reading" for="peter-time" class="mb-3 block text-base tabular-nums">${sampleReading(samples[index])}</output>
    <div id="peter-charts">${windCharts(samples,index,chartWidth())}</div>
    <label for="peter-time" class="sr-only">Čas meritve Sv. Peter</label>
    <input id="peter-time" type="range" min="0" max="${samples.length-1}" value="${index}" aria-valuetext="${escape(sampleLabel(samples[index]))}" class="min-h-10 w-full accent-zinc-700" />
    <p class="mt-2 text-[10px] text-zinc-500">${escape(date(samples[0].timestamp))}–${escape(date(latest!.timestamp))} · Europe/Ljubljana</p>`:'';
  return `<tr id="peter-detail"><td colspan="5" class="border-b border-zinc-300 py-4"><div role="region" aria-label="Grafi Sv. Peter" aria-busy="${historyLoading}">
    <div class="mb-3 flex items-center justify-between gap-2"><span class="text-xs font-medium">Sv. Peter</span><a href="https://vetr.si/peter" target="_blank" rel="noopener noreferrer" class="text-xs text-zinc-500 underline">vetr.si</a></div>
    <p id="peter-history-status" role="status" class="mb-2 text-xs ${historyError||stale?'text-amber-700':'text-zinc-500'}">${escape(historyError||(historyLoading?'Nalaganje…':stale?'Zastarele meritve':!samples.length?'Ni meritev.':''))}</p>${content}
  </div></td></tr>`;
}
async function loadPeterHistory() {
  const request=++historyRequest;
  historyLoading=!peterHistory?.data;historyError='';render();
  try {
    const result=await source<WindSample[]>('history:vetr:peter');
    if(request!==historyRequest)return;
    peterHistory=result;
    historyError=result.error?(result.data?.length?'Napaka vira · zadnje shranjene meritve.':'Zgodovina ni na voljo.'):'';
  } catch {
    if(request!==historyRequest)return;
    historyError=peterHistory?.data?'Vir ni dosegljiv · zadnje shranjene meritve.':'Zgodovina ni na voljo.';
  }
  if(request===historyRequest){historyLoading=false;render();}
}
const stored=read<unknown>('pg-favorites',[]);
const saved=new Set<string>(Array.isArray(stored)?stored.filter(value=>typeof value==='string'):[]);
function render() {
  const active=document.activeElement as HTMLElement|null;
  const focused=active?.id==='peter-time'?'#peter-time':active?.dataset.expand?'[data-expand="peter"]':active?.dataset.save?`[data-save="${CSS.escape(active.dataset.save)}"]`:null;
  const query=$<HTMLInputElement>('search').value.trim().toLocaleLowerCase('sl');
  const region=$<HTMLSelectElement>('region-filter').value;
  const filter=$<HTMLSelectElement>('source-filter').value;
  const visible=stations.filter(s=>(!query||`${s.name} ${s.region}`.toLocaleLowerCase('sl').includes(query))&&(!region||s.region===region)&&(filter==='all'||s.source===filter||(filter==='favorites'&&saved.has(s.id))));
  visible.sort((a,b)=>Number(freshness(a).stale)-Number(freshness(b).stale)||a.name.localeCompare(b.name,'sl'));
  if(!visible.some(station=>station.id==='vetr-peter'))peterExpanded=false;
  $('station-count').textContent=`${visible.length} postaj`;
  $('stations').setAttribute('aria-busy','false');
  const speed=(n:number|null)=>n===null?'—':n.toFixed(1);
  $('stations').innerHTML=visible.length?visible.map(station=>{
    const {stale,label}=freshness(station);
    const failed=Boolean(snapshots.get(station.source)?.error);
    return `<tr class="border-b border-zinc-200 align-top ${stale?'text-zinc-500':''}">
      <td class="py-2 pr-1">${station.id==='vetr-peter'?`<button data-expand="peter" aria-expanded="${peterExpanded}" aria-controls="peter-detail" class="min-h-8 break-words text-left hover:underline">${escape(station.name)} <span aria-hidden="true" class="text-xs text-zinc-500">${peterExpanded?'−':'+'}</span></button>`:`<a href="${escape(station.url)}" target="_blank" rel="noopener noreferrer" class="break-words hover:underline">${escape(station.name)}</a>`}
        <p class="mt-0.5 text-[10px] text-zinc-500">${sourceLabel[station.source]} · ${station.observedAt?escape(date(station.observedAt)):''}</p>
        <p class="text-[10px] ${stale||failed?'text-amber-700':'text-zinc-500'}">${escape(label)}${failed?' · napaka vira':''}</p>
        ${station.note?`<p class="text-xs text-amber-700">${escape(station.note)}</p>`:''}</td>
      <td class="py-2 text-right font-mono tabular-nums">${speed(station.avg)}</td>
      <td class="py-2 text-right font-mono tabular-nums">${speed(station.gust)}</td>
      <td class="py-2 text-center text-xs">${escape(station.direction)}</td>
      <td><button data-save="${escape(station.id)}" aria-label="${saved.has(station.id)?'Odstrani':'Shrani'} ${escape(station.name)}" aria-pressed="${saved.has(station.id)}" class="h-11 w-10 text-lg text-zinc-500">${saved.has(station.id)?'★':'☆'}</button></td>
    </tr>${station.id==='vetr-peter'?(peterExpanded?historyRow():'<tr id="peter-detail" hidden><td colspan="5"></td></tr>'):''}`;
  }).join(''):'<tr><td colspan="5" class="py-6 text-zinc-500">Ni postaj.</td></tr>';
  if(focused)document.querySelector<HTMLElement>(focused)?.focus({preventScroll:true});
  centerSelected();
}
// The chart is wider than the screen; keep the selected reading in view after each redraw.
function centerSelected() {
  const scroller=document.querySelector<HTMLElement>('[data-wind-scroll]');
  if(scroller)scroller.scrollLeft=Number(scroller.dataset.selectedX)-scroller.clientWidth/2;
}
async function update() {
  const errors:string[]=[];
  await Promise.all(['vetr','skytech','arso','luftar'].map(async key=>{
    try {
      const result=await source<Station[]>(key);
      if(result.data) stations=[...stations.filter(s=>s.source!==key),...result.data];
      if(result.error) errors.push(`${key}: napaka vira; zadnji shranjeni podatki.`);
    } catch {errors.push(`${key}: vir ni dosegljiv.`);}
  }));
  $('wind-errors').textContent=errors.join(' ');
  const select=$<HTMLSelectElement>('region-filter'),selected=select.value;
  select.innerHTML='<option value="">Vse regije</option>'+[...new Set(stations.map(s=>s.region).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'sl')).map(region=>`<option value="${escape(region)}">${escape(region)}</option>`).join('');
  select.value=selected;render();
  if(peterExpanded)await loadPeterHistory();
}
$('stations').addEventListener('input',event=>{
  const slider=event.target as HTMLInputElement;
  if(slider.id!=='peter-time')return;
  const samples=peterHistory?.data||[],sample=samples[Number(slider.value)];
  if(!sample)return;
  selectedTime=sample.timestamp;
  $('peter-charts').innerHTML=windCharts(samples,Number(slider.value),chartWidth());
  centerSelected();
  $('peter-reading').innerHTML=sampleReading(sample);
  slider.setAttribute('aria-valuetext',sampleLabel(sample));
});
$('stations').addEventListener('click',event=>{
  const target=event.target as HTMLElement;
  const arrow=target.closest<SVGElement>('[data-history-index]');
  if(arrow) {
    const slider=$<HTMLInputElement>('peter-time');
    slider.value=arrow.dataset.historyIndex!;
    slider.dispatchEvent(new Event('input',{bubbles:true}));
    return;
  }
  if(target.closest('[data-expand="peter"]')) {
    peterExpanded=!peterExpanded;
    if(peterExpanded)void loadPeterHistory();
    else {++historyRequest;historyLoading=false;render();}
    document.querySelector<HTMLButtonElement>('[data-expand="peter"]')?.focus({preventScroll:true});
    return;
  }
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-save]');
  const id=button?.dataset.save;if(!id)return;
  saved.has(id)?saved.delete(id):saved.add(id);save('pg-favorites',[...saved]);render();
});
$('search').addEventListener('input',render);
addEventListener('resize',()=>{if(peterExpanded)render();});
$('source-filter').addEventListener('change',render);
$('region-filter').addEventListener('change',render);
startPolling(update,render);
