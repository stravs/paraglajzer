import type { Frame } from '../lib/sources';
import { regionalCharts,regionalImage,type JadralciRun } from '../lib/jadralci';
import { $,escape,date,source,imageSource,startPolling } from './weather';

interface Thermals { issuedAt:string; items:{title:string; text:string; maxLift:number|null}[]; }
let thermalVersion=0;
async function loadThermals() {
  const version=++thermalVersion;
  const region=$<HTMLSelectElement>('thermal-region').value;
  $('thermals').textContent='Nalaganje…'; $('thermal-meta').textContent='';
  try {
    const result=await source<Thermals>(`thermal:${region}`);
    if (version!==thermalVersion) return;
    $('thermals').innerHTML=result.data?.items.map(item=>`<div class="border-b border-zinc-200 py-2"><h3 class="mb-2 text-xs font-medium">${escape(item.title)}</h3><p class="text-[11px] leading-6">${item.maxLift==null ? escape(item.text) : `<span class="text-lg font-medium">${item.maxLift.toFixed(1)}</span> <span class="text-[10px]">m/s</span>`}</p></div>`).join('') || 'Ni podatkov.';
    $('thermal-meta').textContent=[result.data?`Izdano: ${result.data.issuedAt}`:'',result.error?'Napaka vira · shranjena napoved':''].filter(Boolean).join(' · ');
  } catch { if (version===thermalVersion) $('thermals').textContent='Napoved termike ni na voljo.'; }
}

let chartVersion=0;
let chartSignature='';
async function loadRegionalCharts() {
  let version=chartVersion;
  const container=$('regional-images');
  const region=$<HTMLSelectElement>('chart-region').value;
  try {
    const result=await source<JadralciRun>('jadralci');
    if (version!==chartVersion) return;
    if (!result.data) throw new Error('No model run');
    const run=result.data;
    const staleRun=Date.now()-Date.parse(run.runAt)>24*3600000;
    $('regional-meta').textContent=`ALADIN/SI · zagon ${run.runAt.slice(0,10)} ${run.runAt.slice(11,16)} UTC${result.error ? ' · Napaka vira · shranjeni zagon' : ''}${staleRun ? ' · Star zagon' : ''}`;
    const signature=JSON.stringify([run,region]);
    if (signature===chartSignature) return;
    version=++chartVersion;
    chartSignature=signature;
    const charts=regionalCharts(run,region);
    container.setAttribute('aria-busy','true');
    container.innerHTML=charts.map((chart,index)=>`<figure class="min-w-0">
      <figcaption class="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
        <span class="font-semibold">${escape(chart.title)}${chart.validAt ? ' · '+escape(date(chart.validAt)) : ''}</span>
        <a href="${escape(regionalImage(chart.key)!.url)}" target="_blank" rel="noopener noreferrer" class="text-xs text-zinc-500">ARSO ↗</a>
      </figcaption>
      <div id="regional-image-${index}" class="min-h-32 text-xs text-zinc-500">Nalaganje…</div>
    </figure>`).join('');
    const statuses=await Promise.all(charts.map(async(chart,index)=>{
      try {
        const result=await imageSource(chart.key);
        if (version!==chartVersion) return false;
        const img=new Image();
        img.src=result.url;img.alt=chart.title+(chart.validAt?' · '+date(chart.validAt):'');
        img.className='h-auto w-full';img.width=645;img.decoding='async';
        const target=$(`regional-image-${index}`);const link=document.createElement('a');link.href=regionalImage(chart.key)!.url;link.target='_blank';link.rel='noopener noreferrer';link.appendChild(img);target.replaceChildren(link);
        if(result.stale) {const p=document.createElement('p');p.textContent='Shranjena slika · napaka vira';p.className='p-2 text-xs text-amber-700';target.replaceChildren(link,p);}
        return true;
      } catch {
        if(version===chartVersion) $(`regional-image-${index}`).textContent='Slika ni na voljo';
        return false;
      }
    }));
    if(version===chartVersion) {
      container.setAttribute('aria-busy','false');
      if(statuses.some(ok=>!ok)) chartSignature=''; // Retry failed images on the next visible check.
    }
  } catch {
    if(version===chartVersion) {
      $('regional-meta').textContent='Slike ARSO niso na voljo';
      container.setAttribute('aria-busy','false');
    }
  }
}
$('chart-region').addEventListener('change',()=>{
  ++chartVersion; chartSignature='';
  $('regional-images').replaceChildren();
  void loadRegionalCharts();
});

let frames:Frame[]=[];
let layerVersion=0,frameVersion=0;
let layerSignature='';
async function showFrame() {
  const version=++frameVersion;
  const frame=frames[+$<HTMLInputElement>('forecast-step').value];
  if(!frame)return;
  const image=$<HTMLImageElement>('forecast-image');
  image.hidden=true;$('map-placeholder').hidden=false;$('map-placeholder').textContent='Nalaganje…';
  $('map-time').textContent=date(frame.validAt);
  $('map-meta').textContent=`Zagon ${date(frame.run)}${Date.parse(frame.validAt)<Date.now()?' · Pretekla napoved':''}`;
  $<HTMLAnchorElement>('map-original').href=frame.url;
  try {
    const result=await imageSource(`frame:${frame.url.split('/').at(-1)}`);
    if(version!==frameVersion)return;
    image.src=result.url;image.hidden=false;$('map-placeholder').hidden=true;
    if(result.stale)$('map-meta').textContent+=' · Shranjena slika · napaka vira';
  } catch {if(version===frameVersion)$('map-placeholder').textContent='Slika ni na voljo.';}
}
async function loadFrames() {
  const version=++layerVersion;
  const key=`zaladin:${$<HTMLSelectElement>('layer').value}`;
  try {
    const result=await source<Frame[]>(key);
    if(version!==layerVersion)return;
    const signature=JSON.stringify([key,result.data,result.error]);
    if(signature===layerSignature)return;
    if(!result.data?.length)throw new Error('Ni slik');
    layerSignature=signature;frames=result.data;
    const slider=$<HTMLInputElement>('forecast-step');
    slider.max=String(frames.length-1);
    const next=frames.findIndex(frame=>Date.parse(frame.validAt)>=Date.now());
    slider.value=String(next<0?frames.length-1:next);slider.disabled=false;
    await showFrame();
    if(result.error)$('map-meta').textContent+=' · Napaka vira · shranjena napoved';
  } catch {
    if(version===layerVersion){
      $('forecast-image').hidden=true;$('map-placeholder').hidden=false;
      $('map-placeholder').textContent='Napoved ni na voljo.';
      $<HTMLInputElement>('forecast-step').disabled=true;
    }
  }
}
$('thermal-region').addEventListener('change',()=>void loadThermals());
$('layer').addEventListener('change',()=>{
  ++frameVersion;$('forecast-image').hidden=true;
  $('map-placeholder').hidden=false;$('map-placeholder').textContent='Nalaganje…';
  $<HTMLInputElement>('forecast-step').disabled=true;
  void loadFrames();
});
$('forecast-step').addEventListener('input',()=>{
  const frame=frames[+$<HTMLInputElement>('forecast-step').value];
  if(frame)$('map-time').textContent=date(frame.validAt);
});
$('forecast-step').addEventListener('change',()=>void showFrame());

async function loadDetail(kind:'aviation'|'sounding'|'radar') {
  if(!$<HTMLDetailsElement>(`${kind}-detail`).open)return;
  const target=$(kind==='aviation'?'aviation-text':`${kind}-image`);
  try {
    if(kind==='aviation') {
      const result=await source<string>('aviation');
      target.textContent=(result.error?'Napaka vira · shranjena napoved\n\n':'')+(result.data||'Ni podatkov.');
    } else {
      const result=await imageSource(kind);
      const image=new Image();image.src=result.url;image.alt=kind==='radar'?'Radar padavin':'Sondaža Ljubljana';
      image.className='h-auto w-full max-w-[740px]';
      target.replaceChildren(image);
      if(result.stale){const warning=document.createElement('p');warning.textContent='Shranjena slika · napaka vira';target.appendChild(warning);}
    }
  } catch {target.textContent='Vir ni dosegljiv.';}
}
for(const kind of ['aviation','sounding','radar'] as const) {
  $(`${kind}-detail`).addEventListener('toggle',()=>void loadDetail(kind));
}
startPolling(()=>Promise.allSettled([
  loadRegionalCharts(),loadThermals(),loadFrames(),
  ...(['aviation','sounding','radar'] as const).map(kind=>loadDetail(kind)),
]));
