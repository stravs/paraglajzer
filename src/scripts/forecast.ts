import type { Frame } from '../lib/sources';
import { regionalCharts,regionalImage,thermalRegionFor,thermalRegions,type JadralciRun } from '../lib/jadralci';
import { $,escape,date,source,imageSource,startPolling } from './weather';

interface Thermals { issuedAt:string; items:{title:string; text:string; maxLift:number|null}[]; }
let thermalVersion=0;
async function loadThermals() {
  const version=++thermalVersion;
  // The page's one region picker chooses the Jadralci region; thermals use the region it belongs to.
  const region=thermalRegionFor[$<HTMLSelectElement>('chart-region').value as keyof typeof thermalRegionFor];
  $('thermal-region-name').textContent=thermalRegions[region];
  $('thermals').textContent='Nalaganje…'; $('thermal-meta').textContent='';
  try {
    const result=await source<Thermals>(`thermal:${region}`);
    if (version!==thermalVersion) return;
    $('thermals').innerHTML=result.data?.items.map(item=>`<div class="min-w-0 py-1"><h3 class="text-xs text-zinc-500">${escape(item.title)}</h3><p class="text-[11px] leading-6">${item.maxLift==null ? escape(item.text) : `<span class="text-lg font-medium">${item.maxLift.toFixed(1)}</span> <span class="text-[10px]">m/s</span>`}</p></div>`).join('') || 'Ni podatkov.';
    $('thermal-meta').textContent=[result.data?`Izdano: ${result.data.issuedAt}`:'',result.error?'Napaka vira · shranjena napoved':''].filter(Boolean).join(' · ');
  } catch { if (version===thermalVersion) $('thermals').textContent='Napoved termike ni na voljo.'; }
}

// Chart images link to ARSO's original on desktop only; on phones they are swiped, so taps do nothing
// (the caption's "ARSO ↗" link stays).
const imageLinkClass='block max-md:pointer-events-none';
// The measured Ljubljana sounding (napoved.astro) sits after the forecast charts. It updates every 30 min,
// while the regional charts only change with a new model run, so it refreshes on its own.
const soundingUrl='https://meteo.arso.gov.si/uploads/probase/www/aviation/observ/upper/graphic/sigps_ljubljana-bezigrad.png';
async function loadSounding() {
  const target=document.getElementById('sounding-image');
  if(!target)return;
  try {
    const result=await imageSource('sounding');
    if(target.dataset.url===result.url)return;
    const image=new Image();image.src=result.url;image.alt='Sondaža Ljubljana';image.className='h-auto w-full';image.decoding='async';
    const link=document.createElement('a');link.href=soundingUrl;link.target='_blank';link.rel='noopener noreferrer';link.className=imageLinkClass;link.appendChild(image);
    target.replaceChildren(link);target.dataset.url=result.url;
    if(result.stale){const warning=document.createElement('p');warning.textContent='Shranjena slika · napaka vira';warning.className='p-2 text-xs text-amber-700';target.appendChild(warning);}
  } catch {if(!target.dataset.url)target.textContent='Slika ni na voljo';}
}
// Dots under the swipeable chart row on phones: the current chart is dark; tapping a dot scrolls to it.
// Distance between two charts in the row (chart width plus the gap).
function chartStep() {
  const [first,second]=$('regional-images').children as HTMLCollectionOf<HTMLElement>;
  return second&&first?Math.max(1,second.offsetLeft-first.offsetLeft):1;
}
const currentChart=()=>Math.round($('regional-images').scrollLeft/chartStep());
function renderDots() {
  const count=$('regional-images').children.length,active=currentChart();
  $('regional-dots').innerHTML=Array.from({length:count},(_,i)=>`<button type="button" data-chart-index="${i}" tabindex="-1" class="size-2 rounded-full ${i===active?'bg-zinc-800':'bg-zinc-300'}"></button>`).join('');
}
$('regional-images').addEventListener('scroll',()=>{
  const active=currentChart();
  $('regional-dots').querySelectorAll('button').forEach((dot,i)=>{dot.classList.toggle('bg-zinc-800',i===active);dot.classList.toggle('bg-zinc-300',i!==active);});
},{passive:true});
$('regional-dots').addEventListener('click',event=>{
  const index=(event.target as Element).closest<HTMLElement>('[data-chart-index]')?.dataset.chartIndex;
  const container=$('regional-images');
  if(index!==undefined)container.scrollTo({left:+index*chartStep(),behavior:'smooth'});
});
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
    $('regional-meta').textContent=`${runLabel(run.runAt)}${result.error ? ' · Napaka vira · shranjena napoved' : ''}${staleRun ? ' · Stara napoved' : ''}`;
    const signature=JSON.stringify([run,region]);
    if (signature===chartSignature) return;
    version=++chartVersion;
    chartSignature=signature;
    const charts=regionalCharts(run,region);
    container.setAttribute('aria-busy','true');
    container.innerHTML=charts.map((chart,index)=>`<figure class="w-full min-w-0 shrink-0 snap-center md:w-auto">
      <figcaption class="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
        <span class="font-semibold">${escape(chart.title)}${chart.validAt ? ' · '+escape(date(chart.validAt)) : ''}</span>
        <a href="${escape(regionalImage(chart.key)!.url)}" target="_blank" rel="noopener noreferrer" class="text-xs text-zinc-500">ARSO ↗</a>
      </figcaption>
      <div id="regional-image-${index}" class="min-h-32 text-xs text-zinc-500">Nalaganje…</div>
    </figure>`).join('');
    container.scrollLeft=0;renderDots();
    const statuses=await Promise.all(charts.map(async(chart,index)=>{
      try {
        const result=await imageSource(chart.key);
        if (version!==chartVersion) return false;
        const img=new Image();
        img.src=result.url;img.alt=chart.title+(chart.validAt?' · '+date(chart.validAt):'');
        img.className='h-auto w-full';img.width=645;img.decoding='async';
        const target=$(`regional-image-${index}`);const link=document.createElement('a');link.href=regionalImage(chart.key)!.url;link.target='_blank';link.rel='noopener noreferrer';link.className=imageLinkClass;link.appendChild(img);target.replaceChildren(link);
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
  void loadRegionalCharts();void loadThermals();
});

// Model run as "Napoved od torka 13:00" (Slovenian time). "od" takes the genitive weekday.
const genitive:Record<string,string>={ponedeljek:'ponedeljka',torek:'torka',sreda:'srede','četrtek':'četrtka',petek:'petka',sobota:'sobote',nedelja:'nedelje'};
function runLabel(value:string) {
  const time=new Date(value),zone={timeZone:'Europe/Ljubljana'} as const;
  const day=new Intl.DateTimeFormat('sl-SI',{...zone,weekday:'long'}).format(time);
  const clock=new Intl.DateTimeFormat('sl-SI',{...zone,hour:'2-digit',minute:'2-digit'}).format(time);
  return `Napoved od ${genitive[day]??day} ${clock}`;
}
// Forecast time as weekday and time, e.g. "Torek 19:00".
function longDate(value:string) {
  const time=new Date(value),zone={timeZone:'Europe/Ljubljana'} as const;
  const day=new Intl.DateTimeFormat('sl-SI',{...zone,weekday:'long'}).format(time);
  const clock=new Intl.DateTimeFormat('sl-SI',{...zone,hour:'2-digit',minute:'2-digit'}).format(time);
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} ${clock}`;
}
let frames:Frame[]=[],current=0;
let layerVersion=0,frameVersion=0;
let layerSignature='';
// Shows frame `current`. The previous image stays (dimmed) until the new one has loaded, so the page
// never collapses to a placeholder and jumps while stepping through frames.
async function showFrame() {
  const version=++frameVersion;
  const frame=frames[current];
  if(!frame)return;
  const image=$<HTMLImageElement>('forecast-image');
  const slider=$<HTMLInputElement>('forecast-step');
  slider.max=String(frames.length-1);slider.value=String(current);slider.disabled=false;
  $('map-time').textContent=longDate(frame.validAt);
  $('map-position').textContent=`${current+1} / ${frames.length}`;
  $('map-meta').textContent='';
  // Zaladin frames can come from a different model run than the Jadralci charts.
  $('map-run').textContent=runLabel(frame.run);
  image.classList.add('opacity-60');
  try {
    const result=await imageSource(`frame:${frame.url.split('/').at(-1)}`);
    if(version!==frameVersion)return;
    image.src=result.url;await image.decode().catch(()=>{});
    if(version!==frameVersion)return;
    image.hidden=false;image.classList.remove('opacity-60');$('map-placeholder').hidden=true;
    if(result.stale)$('map-meta').textContent='Shranjena slika · napaka vira';
  } catch {
    if(version!==frameVersion)return;
    image.classList.remove('opacity-60');
    if(image.hidden){$('map-placeholder').hidden=false;$('map-placeholder').textContent='Slika ni na voljo.';}
    else $('map-meta').textContent='Slika ni na voljo';
  }
}
function step(by:number) {
  const next=Math.min(frames.length-1,Math.max(0,current+by));
  if(next===current||!frames.length)return;
  current=next;void showFrame();
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
    // Start on the first frame that is not in the past.
    const next=frames.findIndex(frame=>Date.parse(frame.validAt)>=Date.now());
    current=next<0?frames.length-1:next;
    await showFrame();
    if(result.error)$('map-meta').textContent='Napaka vira · shranjena napoved';
  } catch {
    if(version===layerVersion){
      $('forecast-image').hidden=true;$('map-placeholder').hidden=false;
      $('map-placeholder').textContent='Napoved ni na voljo.';
      $<HTMLInputElement>('forecast-step').disabled=true;
    }
  }
}
$('layer').addEventListener('change',()=>{
  // Keep the current image (dimmed) until the new layer's frame arrives.
  ++frameVersion;frames=[];$('forecast-image').classList.add('opacity-60');
  $<HTMLInputElement>('forecast-step').disabled=true;
  void loadFrames();
});
// The slider previews the time while dragging and loads the frame when released (one image, not every step).
$('forecast-step').addEventListener('input',()=>{
  const frame=frames[+$<HTMLInputElement>('forecast-step').value];
  if(frame){$('map-time').textContent=longDate(frame.validAt);$('map-position').textContent=`${+$<HTMLInputElement>('forecast-step').value+1} / ${frames.length}`;}
});
$('forecast-step').addEventListener('change',()=>{current=+$<HTMLInputElement>('forecast-step').value;void showFrame();});
// Horizontal swipe on touch screens: at least 40 px, and more sideways than up/down.
let touchStart:{x:number;y:number}|null=null;
$('forecast-viewer').addEventListener('touchstart',event=>{const t=event.touches[0];touchStart={x:t.clientX,y:t.clientY};},{passive:true});
$('forecast-viewer').addEventListener('touchend',event=>{
  if(!touchStart)return;
  const t=event.changedTouches[0],dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y;touchStart=null;
  if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)){event.preventDefault();step(dx<0?1:-1);}
});

// Text forecast and radar are always shown, refreshed with the page's normal checks.
async function loadDetail(kind:'aviation'|'radar') {
  const target=$(kind==='aviation'?'aviation-text':`${kind}-image`);
  try {
    if(kind==='aviation') {
      const result=await source<string>('aviation');
      target.textContent=(result.error?'Napaka vira · shranjena napoved\n\n':'')+(result.data||'Ni podatkov.');target.classList.remove('text-zinc-500');
    } else {
      const result=await imageSource(kind);
      const image=new Image();image.src=result.url;image.alt='Radar padavin';
      image.className='h-auto w-full max-w-[740px]';
      target.replaceChildren(image);
      if(result.stale){const warning=document.createElement('p');warning.textContent='Shranjena slika · napaka vira';target.appendChild(warning);}
    }
  } catch {target.textContent='Vir ni dosegljiv.';}
}
startPolling(()=>Promise.allSettled([
  loadRegionalCharts(),loadSounding(),loadThermals(),loadFrames(),
  ...(['aviation','radar'] as const).map(kind=>loadDetail(kind)),
]));
