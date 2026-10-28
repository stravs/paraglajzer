import { Map as MapLibre,Marker,NavigationControl,Popup,setWorkerUrl,type StyleSpecification } from 'maplibre-gl';
import { LogoControl } from '@maptoolkit/maplibre-logo-control';
import '@maptoolkit/maplibre-logo-control/style.css';
// MapLibre finds its worker next to its own module, which Vite moves; point it at the real file.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Station } from '../lib/sources';
import type { WindSample } from '../lib/history';
import { webcams,type Webcam } from '../lib/webcams';
import { stationSpots } from '../lib/station-spots';
import { $,escape,date,freshness,read,save,source,sourceLabel,startPolling,type Snapshot } from './weather';
import { windCharts,sampleLabel,sampleReading,windColor } from './wind-charts';
import { windRose } from './rose';
import type { WindRose } from '../lib/rose';

// Flat, north-up Maptoolkit map (hillshaded, with contours): no tilt or rotation, so arrows keep true
// compass angles.
setWorkerUrl(workerUrl);
// Maptoolkit layers left out for a cleaner flying map, by layer-id prefix: hiking routes, points of interest
// (generic, drinking water, climbing, huts), buildings, paths, minor roads, railways, ferries, road
// restrictions and walls, protected areas, province borders, rocks, land use and sea depth. Kept: terrain,
// contours, peaks, places, water, major roads, cable cars and country borders.
const hiddenMapLayers=['road_hiking','poi_generic','poi_drinking','poi_climbing','poi_hut','building_','road_path','road_minor',
  'road_rail','road_ferry','road_restriction','road_walls','border_protected','border_admin_province','nature_rocks','nature_landuse','water_bathymetry',
  // The three soft "ambient occlusion" shadings: each loads its own extra-large elevation tiles (about half of
  // all map bytes); the sharp hillshade on the same data stays.
  'relief_hillshade_ao'];
// A lighter style for a faster first load. A map tile is drawn only once all its fonts and images have arrived, so:
// - all labels use one font (Ysabeau Regular) instead of eleven (other Ysabeau cuts, Noto Sans); each font
//   costs ~160 KB for the Slovenian letters;
// - the "nature" texture sprite (~0.8 MB, faint forest and tidal-flat patterns) and its layers are left out, as is
//   the icon sprite that only hidden layers used;
// - sources no remaining layer uses are dropped, so their TileJSON isn't fetched;
// - the hillshade's elevation tiles are drawn at 1024 px, so one zoom level coarser tiles are fetched: a quarter
//   as many (about 0.9 MB instead of 3 MB zoomed in), and the shading looks the same.
const font='Ysabeau Regular';
function trimStyle(style:StyleSpecification):StyleSpecification {
  const layers=(JSON.parse(JSON.stringify(style.layers).replace(/"(?:Ysabeau|Noto Sans)[^"]*"/g,JSON.stringify(font))) as StyleSpecification['layers'])
    .filter(layer=>!hiddenMapLayers.some(prefix=>layer.id.startsWith(prefix))&&!JSON.stringify(layer).includes('"nature:'));
  const used=new Set(layers.map(layer=>'source' in layer?layer.source:undefined));
  return {...style,layers,
    sources:Object.fromEntries(Object.entries(style.sources).filter(([id])=>used.has(id))
      .map(([id,source])=>[id,id==='rgb-tiles'?{...source,tileSize:1024}:source])),
    sprite:Array.isArray(style.sprite)?style.sprite.filter(sprite=>sprite.id==='water'):style.sprite};
}
// Only Slovenia is shown: the map can't be moved or zoomed out far past it, so no tiles load for the rest of Europe.
const slovenia:[[number,number],[number,number]]=[[12.9,45.1],[17.1,47.2]];
// The browser remembers the last map position and reopens there. Without one (first visit, storage
// blocked), desktop starts on all of Slovenia (all stations) and phones on the home sites
// Sv. Peter, Stol (Karavanke) and Gozd, with the search bar at the bottom.
const savedView=read<{center?:unknown;zoom?:unknown}|null>('mapView',null);
const hasSavedView=Array.isArray(savedView?.center)&&savedView.center.length===2&&savedView.center.every(Number.isFinite)&&Number.isFinite(savedView?.zoom);
const map=new MapLibre({
  container:'map',...(hasSavedView
    ?{center:savedView!.center as [number,number],zoom:savedView!.zoom as number}
    :matchMedia('(min-width: 768px)').matches
    ?{bounds:[[13.38,45.42],[16.6,46.88]],fitBoundsOptions:{padding:{top:110,bottom:40,left:40,right:60}}}
    :{bounds:[[14.17,46.34],[14.34,46.44]],fitBoundsOptions:{padding:{top:60,bottom:110,left:60,right:60}}}),maxPitch:0,dragRotate:false,touchPitch:false,attributionControl:{compact:false},
  // Maptoolkit "Hiking" (vector, hillshading, contours; free, no key), with the layers above left out (trimStyle).
  style:'https://styles.maptoolkit.org/hiking.json',
  maxBounds:slovenia,
  transformStyle:(_previous,next)=>trimStyle(next),
});
map.touchZoomRotate.disableRotation();map.keyboard.disableRotation();
// On phones the header bar hides on the first move by the user (drag, zoom, keys); moves from code don't count.
map.on('movestart',event=>{if(event.originalEvent)$('map-page').removeAttribute('data-header');});
map.on('moveend',()=>{
  const {lng,lat}=map.getCenter();
  save('mapView',{center:[+lng.toFixed(5),+lat.toFixed(5)],zoom:+map.getZoom().toFixed(2)});
});
// Maptoolkit's terms require its logo and a fully visible credit on the map.
map.addControl(new LogoControl());
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

// A slim navigation-style arrow pointing where the wind blows (compass direction + 180°), in flying bands
// (green up to 4 m/s, yellow to 7, orange to 10, red above): the inside shows the average, the outline the
// gusts. A thin dark edge keeps every colour visible on light and green map areas. Its label is a white pill just below: average bold, gusts
// lighter. Zoomed out, a smaller arrow with the rounded average only, so dense areas stay readable.
// Stale stations are half transparent (solid on hover); the selected one gets a blue ring. Without a
// direction, a dot replaces the arrow.
// Drawn twice: a dark wide stroke underneath, then the shape filled with `fill` and stroked with `stroke` on top.
function arrowShape(deg:number|undefined,fill:string,stroke=fill) {
  const outline=(paint:string)=>deg===undefined?`<circle r="6" ${paint}/>`
    :`<path transform="rotate(${deg+180})" d="M0 -14 L10 12 L0 6 L-10 12 Z" stroke-linejoin="round" ${paint}/>`;
  return outline('fill="none" stroke="rgb(0 0 0 / 0.55)" stroke-width="6"')+outline(`fill="${fill}" stroke="${stroke}" stroke-width="3.5"`);
}
function icon(station:Station) {
  const {stale}=freshness(station);
  const isSelected=selected?.id===station.id;
  const fill=windColor(station.avg),stroke=windColor(station.gust??station.avg);
  const deg=degrees[station.direction];
  const small=map.getZoom()<7&&!isSelected,size=small?30:46;
  const shape=arrowShape(deg,fill,stroke);
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
// Until the first data arrives, grey arrows spin at the stations' usual spots (lib/station-spots.ts).
const placeholders=layers.wind?stationSpots.map(([lat,lon])=>{
  const element=document.createElement('div');
  element.className='pointer-events-none';element.setAttribute('aria-hidden','true');
  element.innerHTML=`<svg viewBox="-18 -18 36 36" width="46" height="46" class="block animate-spin overflow-visible drop-shadow-[0_1px_2px_rgb(0_0_0/0.35)] motion-reduce:animate-none">${arrowShape(0,'#a1a1aa')}</svg>`;
  return new Marker({element}).setLngLat([lon,lat]).addTo(map);
}):[];
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
      <svg viewBox="0 0 24 24" width="24" height="24" class="mx-auto" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${layerButtons[layer].svg}</svg></button>`).join('');
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
// The panel shows the last 4 hours of readings (before the newest one).
function recent():WindSample[] {
  const all=history?.data||[],newest=Date.parse(all.at(-1)?.timestamp??'');
  return all.filter(sample=>Date.parse(sample.timestamp)>=newest-4*3600000);
}
// While the history loads, placeholders the size of the reading (two lines) and the graph with its legend
// (220 px) keep the panel at its final height, with a spinning arrow as the loading sign.
const readingPlaceholder='<span class="block py-1"><span class="block h-4 w-64 max-w-full animate-pulse rounded bg-zinc-100"></span></span>'.repeat(2);
const chartsPlaceholder=`<div class="flex h-[220px] items-center justify-center gap-2 text-sm text-zinc-500"><svg viewBox="-18 -18 36 36" width="28" height="28" class="animate-spin overflow-visible motion-reduce:animate-none" aria-hidden="true">${arrowShape(0,'#a1a1aa')}</svg>Nalaganje…</div>`;
function renderHistory() {
  const samples=recent();
  const latest=samples.at(-1);
  // Same limit as the marker (freshness): ARSO 60 min, faster sources less.
  const stale=selected&&latest&&freshness({...selected,observedAt:latest.timestamp}).stale;
  const status=$('site-history-status');
  status.textContent=historyError||(stale?'Zastarele meritve':!samples.length&&!historyLoading?'Ni meritev.':'');
  status.className=`mb-2 text-xs empty:hidden ${historyError||stale?'text-amber-700':'text-zinc-500'}`;
  if(!samples.length){
    const loading=historyLoading&&!historyError;
    $('site-reading').innerHTML=loading?readingPlaceholder:'';$('site-charts').innerHTML=loading?chartsPlaceholder:'';
    return;
  }
  const found=selectedTime?samples.findIndex(sample=>sample.timestamp===selectedTime):-1;
  const index=found<0?samples.length-1:found;
  $('site-reading').innerHTML=sampleReading(samples[index]);
  $('site-charts').innerHTML=windCharts(samples,index,$('site-charts').clientWidth||400);
}
async function loadHistory() {
  if(!selected)return;
  const request=++historyRequest;
  const [kind,...rest]=selected.id.split('-');
  historyLoading=!history?.data;historyError='';renderHistory();
  try {
    // The station listing can hold a newer reading than the graph (they are checked on their own schedules):
    // then ask for the graph now, once per listing update.
    const listing=await source<Station[]>(kind),newest=history?.data?.at(-1)?.timestamp;
    const behind=!!history&&!!listing.fetchedAt&&history.checkedAt<listing.fetchedAt&&Date.parse(selected?.observedAt??'')>Date.parse(newest??'');
    const result=await source<WindSample[]>(`history:${kind}:${rest.join('-')}`,behind);
    if(request!==historyRequest)return;
    history=result;
    historyError=result.error?(result.data?.length?'Napaka vira · zadnje shranjene meritve.':'Zgodovina ni na voljo.'):'';
  } catch {
    if(request!==historyRequest)return;
    historyError=history?.data?'Vir ni dosegljiv · zadnje shranjene meritve.':'Zgodovina ni na voljo.';
  }
  historyLoading=false;renderHistory();
}

// vetr.si stations also show a wind rose of the last hour; others hide it. Kept while a reload fails.
let roseRequest=0;
async function loadRose() {
  const request=++roseRequest,station=selected;
  if(station?.source!=='vetr'){$('site-rose').hidden=true;return;}
  try {
    const result=await source<WindRose>(`rose:vetr:${station.id.slice(5)}`);
    if(request!==roseRequest)return;
    if(result.data){$('site-rose').innerHTML=windRose(result.data);$('site-rose').hidden=false;}
  } catch {/* The rose is extra; the graph shows the wind. */}
}
function openSite(id:string) {
  const station=stations.find(s=>s.id===id);
  if(!station)return;
  if(selected?.id!==id){history=null;selectedTime=null;$('site-rose').hidden=true;}
  selected=station;
  setPanel(true);
  renderHeader();renderMarkers();
  // Desktop: the map stays as it is. Phones: move the marker above the bottom sheet so it stays visible.
  if(!matchMedia('(min-width: 768px)').matches) {
    const {clientWidth:width,clientHeight:height}=map.getContainer();
    const point=map.project([station.location![1],station.location![0]]);
    map.panBy([point.x-width/2,point.y-height*0.15]);
  }
  void loadHistory();void loadRose();
  showThanks(station.source);
  // Focus the panel itself (no highlighted button); Tab then reaches the close button.
  $('site').focus({preventScroll:true});
}
// Open/close with a slide (up on phones, in from the right on desktop) and fade.
const closedPanel=['invisible','opacity-0','max-md:translate-y-full','md:translate-x-8'];
function setPanel(open:boolean) {for(const name of closedPanel)$('site').classList.toggle(name,!open);}
// Under the graph, thanks to the station's data source (its block in #site-thanks).
function showThanks(source:Station['source']|null) {
  for(const block of $('site-thanks').querySelectorAll<HTMLElement>('[data-source]'))block.hidden=block.dataset.source!==source;
}
// returnFocus: when closed from the keyboard, put focus back on the station's marker.
function closeSite(returnFocus=false) {
  const id=selected?.id;
  selected=null;++historyRequest;
  setPanel(false);renderMarkers();showThanks(null);
  if(id&&returnFocus)markers.get(id)?.getElement()?.focus({preventScroll:true});
}
// detail is 0 when the button is activated from the keyboard.
$('site-close').addEventListener('click',event=>closeSite(event.detail===0));
// Clicking or tapping empty map closes the panel (not a station, a camera or its popup; drags are not clicks).
map.on('click',event=>{
  if(selected&&!(event.originalEvent.target as Element).closest('.maplibregl-marker,.maplibregl-popup'))closeSite();
});
addEventListener('keydown',event=>{if(event.key==='Escape'&&selected)closeSite(true);});
// Reading under the pointer: the sample whose x position on the graph is nearest.
function sampleAt(clientX:number):number {
  const chart=document.querySelector<SVGSVGElement>('#site-charts svg[data-chart]');
  if(!chart?.dataset.xs)return -1;
  const box=chart.getBoundingClientRect(),scale=chart.viewBox.baseVal.width/box.width;
  const x=(clientX-box.left)*scale,xs=chart.dataset.xs.split(',').map(Number);
  return xs.reduce((best,value,i)=>Math.abs(value-x)<Math.abs(xs[best]-x)?i:best,0);
}
function showSample(index:number) {
  const sample=recent()[index];
  if(!sample||sample.timestamp===selectedTime)return;
  selectedTime=sample.timestamp;renderHistory();
}
// Mouse: hovering shows the reading there; leaving goes back to the latest. Touch: a tap or a sideways
// slide shows it (the graph takes sideways drags, `touch-action: pan-y`; vertical swipes still scroll).
$('site-charts').addEventListener('pointermove',event=>showSample(sampleAt(event.clientX)));
$('site-charts').addEventListener('pointerleave',event=>{if(event.pointerType==='mouse'&&selectedTime!==null){selectedTime=null;renderHistory();}});
$('site-charts').addEventListener('click',event=>showSample(sampleAt(event.clientX)));
$('site-charts').addEventListener('keydown',event=>{
  const samples=recent();
  if(!samples.length)return;
  const current=selectedTime?samples.findIndex(sample=>sample.timestamp===selectedTime):samples.length-1;
  const next={ArrowLeft:current-1,ArrowRight:current+1,Home:0,End:samples.length-1}[event.key];
  if(next===undefined)return;
  event.preventDefault();
  if(samples[next]){selectedTime=samples[next].timestamp;renderHistory();}
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
  for(const placeholder of placeholders.splice(0))placeholder.remove();
  renderMarkers();
  if(selected) {
    selected=stations.find(s=>s.id===selected!.id)??selected;
    renderHeader();
    await Promise.all([loadHistory(),loadRose()]);
  }
}
startPolling(update,()=>{renderMarkers();renderHeader();});
