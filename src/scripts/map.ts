import { Map as MapLibre,Marker,NavigationControl,Popup,setWorkerUrl } from 'maplibre-gl';
// MapLibre finds its worker next to its own module, which Vite moves; point it at the real file.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Station } from '../lib/sources';
import type { WindSample } from '../lib/history';
import { webcams,type Webcam } from '../lib/webcams';
import { coveredBounds } from '../lib/gorenjska';
import { $,escape,date,freshness,read,save,source,sourceLabel,startPolling,type Snapshot } from './weather';
import { windCharts,sampleLabel,sampleReading } from './wind-charts';

// Flat, north-up OpenTopoMap (hillshaded, with contours): no tilt or rotation, so arrows keep true
// compass angles. Zoomed out, OpenTopoMap tints mountains orange by height, so its colour is washed
// out there and comes back gradually by zoom 10.
setWorkerUrl(workerUrl);
const map=new MapLibre({
  // Desktop starts on the whole covered area (all stations); phones start on the home sites Sv. Peter,
  // Stol (Karavanke) and Gozd, with the search bar at the bottom.
  container:'map',...(matchMedia('(min-width: 768px)').matches
    ?{bounds:coveredBounds,fitBoundsOptions:{padding:{top:70,bottom:40,left:40,right:60}}}
    :{bounds:[[14.17,46.34],[14.34,46.44]],fitBoundsOptions:{padding:{top:60,bottom:110,left:60,right:60}}}),maxPitch:0,dragRotate:false,touchPitch:false,attributionControl:{compact:true},
  style:{
    version:8,
    sources:{
      topo:{type:'raster',tiles:['a','b','c'].map(s=>`https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),tileSize:256,maxzoom:17,
        attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM · <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'},
    },
    layers:[{id:'topo',type:'raster',source:'topo',paint:{
      'raster-saturation':['interpolate',['linear'],['zoom'],8,-0.85,10,0],
      'raster-brightness-min':['interpolate',['linear'],['zoom'],8,0.4,10,0],
    }}],
  },
});
map.touchZoomRotate.disableRotation();map.keyboard.disableRotation();
// The attribution is a small (i) button that expands on tap; MapLibre opens it on load, so close it.
map.once('load',()=>{
  const attribution=map.getContainer().querySelector('.maplibregl-ctrl-attrib');
  attribution?.removeAttribute('open');attribution?.classList.remove('maplibregl-compact-show');
});
map.addControl(new NavigationControl({showCompass:false}),'bottom-right');

// Compass labels used by both vetr and Skytech tables; the wind comes from this direction.
const degrees:Record<string,number>={S:0,SV:45,V:90,JV:135,J:180,JZ:225,Z:270,SZ:315};
const speed=(n:number|null)=>n===null?'—':n.toFixed(1);
const layers=read('layers',{wind:true,cameras:false});
let stations:Station[]=[];
let selected:Station|null=null;
// Each station has two markers: the arrow (focusable, carries the title) and its number label. They are
// separate so every arrow can draw above every label, including neighbouring stations' labels.
const markers=new Map<string,Marker>(),labels=new Map<string,Marker>();

// A slim navigation-style arrow pointing where the wind blows (compass direction + 180°), coloured by the
// stronger of average and gusts in flying bands: green up to 4 m/s, yellow to 7, orange to 10, red above.
// A white outline with a thin dark edge keeps every colour visible on light and green map areas. Its label is a white pill just below: average bold, gusts
// lighter. Zoomed out, a smaller arrow with the rounded average only, so dense areas stay readable.
// Stale stations are half transparent (solid on hover); the selected one gets a blue ring. Without a
// direction, a dot replaces the arrow.
function icon(station:Station) {
  const {stale}=freshness(station);
  const isSelected=selected?.id===station.id;
  const wind=station.avg===null&&station.gust===null?null:Math.max(station.avg??0,station.gust??0);
  const color=wind===null?'#a1a1aa':wind<=4?'#16a34a':wind<=7?'#eab308':wind<=10?'#f97316':'#dc2626';
  const deg=degrees[station.direction];
  const small=map.getZoom()<7&&!isSelected,size=small?30:46;
  // Drawn twice: a dark wide stroke underneath, then the coloured shape with a white stroke on top.
  const outline=(paint:string)=>deg===undefined?`<circle r="6" ${paint}/>`
    :`<path transform="rotate(${deg+180})" d="M0 -14 L10 12 L0 6 L-10 12 Z" stroke-linejoin="round" ${paint}/>`;
  const shape=outline('fill="none" stroke="rgb(0 0 0 / 0.55)" stroke-width="5"')+outline(`fill="${color}" stroke="white" stroke-width="2.5"`);
  const fade=stale&&!isSelected?'opacity-50 hover:opacity-100':'';
  const arrow=`<svg viewBox="-18 -18 36 36" width="${size}" height="${size}" class="block overflow-visible drop-shadow-[0_1px_2px_rgb(0_0_0/0.35)] transition hover:scale-110 ${fade}">${shape}</svg>`;
  const text=small?(station.avg===null?'—':String(Math.round(station.avg)))
    :`${speed(station.avg)}${station.gust===null?'':`<span class="font-normal text-zinc-500"> / ${speed(station.gust)}</span>`}`;
  const label=`<span class="block rounded-full bg-white/95 font-semibold tabular-nums text-zinc-900 shadow-sm transition ${fade} ${isSelected?'ring-2 ring-blue-600':'ring-1 ring-black/10'} ${small?'px-1 text-[9px] leading-3':'px-1.5 text-[11px] leading-4'}">${text}</span>`;
  // The label hangs from the station point, 2 px below the arrow.
  return {arrow,label,small,labelTop:size/2+2};
}
function label(station:Station) {
  return `${station.name} · veter ${speed(station.avg)} m/s · sunki ${speed(station.gust)} m/s · ${station.direction} · ${freshness(station).label}`;
}
// A Skytech station with the same site name as a nearby vetr station is not shown.
// vetr names add a detail after " - " ("Gozd - Testna"). The distance check keeps
// same-named but different sites, like Stol (Karavanke) and Stol (Kobarid).
const siteName=(station:Station)=>station.name.split(' - ')[0].trim().toLocaleLowerCase('sl');
function hasVetrTwin(station:Station) {
  if(station.source!=='skytech'||!station.location)return false;
  const [lat,lon]=station.location;
  return stations.some(other=>other.source==='vetr'&&other.location&&siteName(other)===siteName(station)&&Math.hypot(other.location[0]-lat,(other.location[1]-lon)*Math.cos(lat*Math.PI/180))*111<5);
}
function renderMarkers() {
  const seen=new Map<string,number>();
  for(const station of stations) {
    if(!station.location||hasVetrTwin(station)){
      markers.get(station.id)?.remove();markers.delete(station.id);labels.get(station.id)?.remove();labels.delete(station.id);continue;
    }
    // Stations at the same spot sit side by side.
    const spot=station.location.map(n=>n.toFixed(2)).join();
    const offset=(seen.get(spot)??0)*40;seen.set(spot,offset/40+1);
    const at:[number,number]=[station.location[1],station.location[0]];
    let marker=markers.get(station.id),labelMarker=labels.get(station.id);
    if(!marker||!labelMarker) {
      const element=document.createElement('div'),labelElement=document.createElement('div');
      element.tabIndex=0;element.setAttribute('role','button');element.className='cursor-pointer';
      labelElement.className='cursor-pointer';labelElement.setAttribute('aria-hidden','true');
      for(const target of [element,labelElement])target.addEventListener('click',event=>{event.stopPropagation();openSite(station.id);});
      element.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openSite(station.id);}});
      marker=new Marker({element}).setLngLat(at).addTo(map);
      labelMarker=new Marker({element:labelElement,anchor:'top'}).setLngLat(at).addTo(map);
      markers.set(station.id,marker);labels.set(station.id,labelMarker);
    }
    const {arrow,label:text,small,labelTop}=icon(station);
    const x=small?offset*0.6:offset;
    const element=marker.setLngLat(at).setOffset([x,0]).getElement();
    const labelElement=labelMarker.setLngLat(at).setOffset([x,labelTop]).getElement();
    element.innerHTML=arrow;labelElement.innerHTML=text;
    // All arrows above all labels; within each, selected above fresh above stale, so live readings are
    // not hidden by dead stations.
    const rank=selected?.id===station.id?2:freshness(station).stale?0:1;
    element.style.zIndex=String(4+rank);labelElement.style.zIndex=String(1+rank);
    element.setAttribute('title',label(station));element.setAttribute('aria-label',label(station));
    element.hidden=labelElement.hidden=!layers.wind;
  }
}

map.on('zoomend',renderMarkers);

// ---- Webcams ----
// Small camera icons on each camera's spot, shown from zoom 9. Station arrows draw above them, so wind
// readings are never hidden where a camera shares a station's spot. Tapping one opens a popup; only then are its images loaded, straight from the operator.
const cameraSvg='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.5"/></svg>';
// The popup always opens above the icon; the map moves the camera into the lower part of the view
// first, so there is room above it and below the search bar.
const popup=new Popup({maxWidth:'320px',anchor:'bottom',offset:14});
function openWebcam(cam:Webcam) {
  // Bust browser caches once a minute so a reopened popup shows a fresh image.
  const minute=Math.floor(Date.now()/60000);
  const body=document.createElement('div');
  body.className='w-72 max-w-full text-xs';
  body.innerHTML=`<p class="mb-1 text-sm font-semibold">${escape(cam.name)}</p><div data-images class="grid max-h-[55dvh] gap-2 overflow-y-auto text-zinc-500"></div>
    <a href="${escape(cam.page)}" target="_blank" rel="noopener noreferrer" class="mt-2 inline-block text-zinc-500 underline">Vir ↗</a>`;
  map.easeTo({center:[cam.location[1],cam.location[0]],offset:[0,map.getContainer().clientHeight*0.3]});
  popup.setLngLat([cam.location[1],cam.location[0]]).setDOMContent(body).addTo(map);
  body.querySelector('[data-images]')!.innerHTML=cam.images.map(image=>{
    const url=`${image.url}${image.url.includes('?')?'&':'?'}t=${minute}`;
    return `<figure><a href="${escape(url)}" target="_blank" rel="noopener noreferrer"><img src="${escape(url)}" alt="${escape(`${cam.name} · ${image.title}`)}" class="aspect-video w-full rounded bg-zinc-100 object-cover"></a>
      <figcaption class="mt-0.5">${escape(image.title)}</figcaption></figure>`;
  }).join('');
}
const cameraMarkers=webcams.map(cam=>{
  const element=document.createElement('div');
  element.className='grid size-6 cursor-pointer place-items-center rounded-full bg-white/95 text-zinc-700 shadow ring-1 ring-black/10 hover:text-black';
  element.innerHTML=cameraSvg;element.tabIndex=0;element.setAttribute('role','button');
  element.setAttribute('aria-label',`Spletna kamera: ${cam.name}`);element.title=`Kamera · ${cam.name}`;
  element.addEventListener('click',event=>{event.stopPropagation();openWebcam(cam);});
  element.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openWebcam(cam);}});
  return new Marker({element}).setLngLat([cam.location[1],cam.location[0]]).addTo(map);
});
function showCameras() {
  for(const marker of cameraMarkers)marker.getElement().hidden=!layers.cameras||map.getZoom()<9;
  if(!layers.cameras)popup.remove();
}
map.on('zoomend',showCameras);showCameras();

// ---- Layers ----
// Wind stations and webcams can each be switched off; wind is on and webcams off by default.
// The choice is remembered per browser.
const layerButtons={
  wind:{title:'Veter',svg:'<path d="M12 3 L18 19 L12 15 L6 19 Z"/>'},
  cameras:{title:'Spletne kamere',svg:'<path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.5"/>'},
} as const;
function setLayer(layer:keyof typeof layerButtons,on:boolean) {
  layers[layer]=on;save('layers',layers);
  if(layer==='wind'){renderMarkers();if(!on&&selected)closeSite();}else showCameras();
  const button=document.querySelector(`[data-layer="${layer}"]`);
  button?.setAttribute('aria-pressed',String(on));
  button?.classList.toggle('text-blue-600',on);button?.classList.toggle('text-zinc-400',!on);
}
map.addControl({
  onAdd() {
    const group=document.createElement('div');
    group.className='maplibregl-ctrl maplibregl-ctrl-group';
    group.innerHTML=(Object.keys(layerButtons) as (keyof typeof layerButtons)[]).map(layer=>`<button type="button" data-layer="${layer}" aria-pressed="${layers[layer]}" title="${layerButtons[layer].title}" aria-label="${layerButtons[layer].title}" class="${layers[layer]?'text-blue-600':'text-zinc-400'}">
      <svg viewBox="0 0 24 24" width="18" height="18" class="mx-auto" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${layerButtons[layer].svg}</svg></button>`).join('');
    group.addEventListener('click',event=>{
      const layer=(event.target as Element).closest<HTMLElement>('[data-layer]')?.dataset.layer as keyof typeof layerButtons|undefined;
      if(layer)setLayer(layer,!layers[layer]);
    });
    return group;
  },
  onRemove() {},
},'bottom-right');

// ---- Site panel ----
let history:Snapshot<WindSample[]>|null=null;
let historyRequest=0,historyLoading=false,historyError='',selectedTime:string|null=null;
function renderHeader() {
  if(!selected)return;
  const {stale,label}=freshness(selected);
  $('site-name').textContent=selected.name;
  $('site-meta').innerHTML=`<a href="${escape(selected.url)}" target="_blank" rel="noopener noreferrer" class="underline">${sourceLabel[selected.source]}</a> · ${escape(selected.region)} · ${selected.observedAt?escape(date(selected.observedAt)):''} · <span class="${stale?'text-amber-700':''}">${escape(label)}</span>`;
}
function centerSelected() {
  const scroller=document.querySelector<HTMLElement>('#site [data-wind-scroll]');
  if(scroller)scroller.scrollLeft=Number(scroller.dataset.selectedX)-scroller.clientWidth/2;
}
function renderHistory() {
  const samples=history?.data||[];
  const latest=samples.at(-1);
  const stale=latest&&Date.now()-Date.parse(latest.timestamp)>25*60000;
  const status=$('site-history-status');
  status.textContent=historyError||(historyLoading?'Nalaganje…':stale?'Zastarele meritve':!samples.length?'Ni meritev.':'');
  status.className=`mb-2 text-xs empty:hidden ${historyError||stale?'text-amber-700':'text-zinc-500'}`;
  const slider=$<HTMLInputElement>('site-time');
  slider.hidden=!samples.length;
  if(!samples.length){$('site-reading').innerHTML='';$('site-charts').innerHTML='';$('site-range').textContent='';return;}
  const found=selectedTime?samples.findIndex(sample=>sample.timestamp===selectedTime):-1;
  const index=found<0?samples.length-1:found;
  slider.max=String(samples.length-1);slider.value=String(index);
  slider.setAttribute('aria-valuetext',sampleLabel(samples[index]));
  $('site-reading').innerHTML=sampleReading(samples[index]);
  $('site-charts').innerHTML=windCharts(samples,index,$('site-charts').clientWidth||400);
  $('site-range').textContent=`${date(samples[0].timestamp)}–${date(latest!.timestamp)} · Europe/Ljubljana`;
  centerSelected();
}
async function loadHistory() {
  if(!selected)return;
  const request=++historyRequest;
  const [kind,...rest]=selected.id.split('-');
  historyLoading=!history?.data;historyError='';renderHistory();
  try {
    const result=await source<WindSample[]>(`history:${kind}:${rest.join('-')}`);
    if(request!==historyRequest)return;
    history=result;
    historyError=result.error?(result.data?.length?'Napaka vira · zadnje shranjene meritve.':'Zgodovina ni na voljo.'):'';
  } catch {
    if(request!==historyRequest)return;
    historyError=history?.data?'Vir ni dosegljiv · zadnje shranjene meritve.':'Zgodovina ni na voljo.';
  }
  historyLoading=false;renderHistory();
}

function openSite(id:string) {
  const station=stations.find(s=>s.id===id);
  if(!station)return;
  if(selected?.id!==id){history=null;selectedTime=null;}
  selected=station;
  $('site').hidden=false;
  renderHeader();renderMarkers();
  // Keep the marker visible beside (desktop) or above (mobile) the panel.
  const {clientWidth:width,clientHeight:height}=map.getContainer();
  const point=map.project([station.location![1],station.location![0]]);
  const wide=matchMedia('(min-width: 768px)').matches;
  const target=wide?[(width-440)/2,height/2]:[width/2,height*0.15];
  map.panBy([point.x-target[0],point.y-target[1]]);
  void loadHistory();
  $('site-close').focus({preventScroll:true});
}
function closeSite() {
  const id=selected?.id;
  selected=null;++historyRequest;
  $('site').hidden=true;renderMarkers();
  if(id)markers.get(id)?.getElement()?.focus();
}
$('site-close').addEventListener('click',closeSite);
addEventListener('keydown',event=>{if(event.key==='Escape'&&selected)closeSite();});
$('site-time').addEventListener('input',()=>{
  const sample=history?.data?.[Number($<HTMLInputElement>('site-time').value)];
  if(!sample)return;
  selectedTime=sample.timestamp;renderHistory();
});
$('site-charts').addEventListener('click',event=>{
  const arrow=(event.target as Element).closest<SVGElement>('[data-history-index]');
  if(!arrow)return;
  const slider=$<HTMLInputElement>('site-time');
  slider.value=arrow.dataset.historyIndex!;slider.dispatchEvent(new Event('input'));
});
addEventListener('resize',()=>{if(selected)renderHistory();});

// ---- Site search ----
// Matches without diacritics, so "kriska" finds "Kriška gora".
const fold=(text:string)=>text.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('sl');
const search=$<HTMLInputElement>('site-search'),results=$('search-results');
let matches:Station[]=[],active=0;
function renderResults() {
  const query=fold(search.value.trim());
  // Only stations shown on the map.
  matches=query?stations.filter(s=>markers.has(s.id)&&fold(`${s.name} ${s.region}`).includes(query))
    .sort((a,b)=>Number(!fold(a.name).startsWith(query))-Number(!fold(b.name).startsWith(query))||a.name.localeCompare(b.name,'sl')).slice(0,8):[];
  active=Math.min(active,Math.max(0,matches.length-1));
  results.hidden=!query;search.setAttribute('aria-expanded',String(Boolean(query)));
  results.innerHTML=matches.length?matches.map((s,i)=>`<li id="search-${i}" role="option" aria-selected="${i===active}" data-id="${escape(s.id)}" class="flex cursor-pointer items-baseline justify-between gap-2 px-3 py-2 ${i===active?'bg-zinc-100':''}">
    <span class="truncate">${escape(s.name)} <span class="text-xs text-zinc-500">${escape(s.region)}</span></span>
    <span class="shrink-0 text-xs text-zinc-500 tabular-nums">${speed(s.avg)} / ${speed(s.gust)} m/s</span></li>`).join('')
    :'<li class="px-3 py-2 text-zinc-500">Ni zadetkov.</li>';
  if(matches.length)search.setAttribute('aria-activedescendant',`search-${active}`);else search.removeAttribute('aria-activedescendant');
}
function pick(station:Station) {
  search.value='';search.blur();
  if(!layers.wind)setLayer('wind',true);
  map.jumpTo({center:[station.location![1],station.location![0]],zoom:Math.max(map.getZoom(),11)});
  openSite(station.id);
}
search.addEventListener('input',()=>{active=0;renderResults();});
search.addEventListener('focus',renderResults);
search.addEventListener('blur',()=>{results.hidden=true;search.setAttribute('aria-expanded','false');});
search.addEventListener('keydown',event=>{
  if((event.key==='ArrowDown'||event.key==='ArrowUp')&&matches.length) {
    event.preventDefault();active=(active+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length;renderResults();
  } else if(event.key==='Enter'&&matches[active]) {event.preventDefault();pick(matches[active]);}
  else if(event.key==='Escape'&&search.value) {event.stopPropagation();search.value='';renderResults();}
});
results.addEventListener('mousedown',event=>event.preventDefault()); // Keep focus so the click lands.
results.addEventListener('click',event=>{
  const id=(event.target as Element).closest<HTMLElement>('[data-id]')?.dataset.id;
  const station=stations.find(s=>s.id===id);
  if(station)pick(station);
});

async function update() {
  const errors:string[]=[];
  await Promise.all(['vetr','skytech','arso','luftar'].map(async key=>{
    try {
      const result=await source<Station[]>(key);
      if(result.data)stations=[...stations.filter(s=>s.source!==key),...result.data];
      if(result.error)errors.push(`${key}: napaka vira`);
    } catch {errors.push(`${key}: vir ni dosegljiv`);}
  }));
  $('map-status').textContent=errors.join(' · ');
  renderMarkers();
  if(selected) {
    selected=stations.find(s=>s.id===selected!.id)??selected;
    renderHeader();
    await loadHistory();
  }
}
startPolling(update,()=>{renderMarkers();renderHeader();});
