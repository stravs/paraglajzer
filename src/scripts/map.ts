import { Map as MapLibre,Marker,NavigationControl,Popup,setWorkerUrl,type StyleSpecification } from 'maplibre-gl';
import { LogoControl } from '@maptoolkit/maplibre-logo-control';
import '@maptoolkit/maplibre-logo-control/style.css';
// MapLibre finds its worker next to its own module, which Vite moves; point it at the real file.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Station,SnowStation,Reading,RiverStation } from '../lib/sources';
import type { WindSample } from '../lib/history';
import { stationSpots } from '../lib/station-spots';
import { $,escape,date,freshness,read,save,source,sourceLabel,startPolling,type Snapshot } from './weather';
import { windCharts,sampleReading,windColor } from './wind-charts';
import { trailHours,type Trail } from '../lib/trail';
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
let stations:Station[]=[];
let selected:Station|null=null;
// Each station has two markers: the arrow (focusable, carries the title) and its number label. They are
// separate so every arrow can draw above every label, including neighbouring stations' labels.
const markers=new Map<string,Marker>(),labels=new Map<string,Marker>();

// A slim navigation-style arrow pointing where the wind blows (compass direction + 180°), in flying bands
// (green up to 4 m/s, yellow to 7, orange to 10, red above): the inner arrow shows the average, the outer one the
// gusts. A thin dark edge keeps every colour visible on light and green map areas. Its label is a white pill just below: average bold, gusts
// lighter. Arrows and labels keep one size at every zoom.
// Stale stations are half transparent (solid on hover); the selected one gets a blue ring. Without a
// direction, a dot replaces the arrow.
// Drawn in three layers: the whole arrow in the `outer` (gusts) colour, a smaller inner arrow in the `inner`
// (average) colour, both with the same thin dark edge. A sharp, narrow dart with a deep notch.
const edge='rgb(0 0 0 / 0.55)',edgeWidth=1.25,innerScale=0.7;
function arrowShape(deg:number|undefined,inner:string,outer=inner) {
  const shape=(paint:string,scale=1)=>deg===undefined?`<circle r="${6*scale}" ${paint}/>`
    :`<path transform="rotate(${deg+180}) translate(0 2) scale(${scale}) translate(0 -2)" d="M0 -16 L8.5 13 L0 5 L-8.5 13 Z" stroke-linejoin="round" ${paint}/>`;
  // Outer: a dark stroke under a coloured one 2 × edgeWidth narrower leaves an edgeWidth dark rim outside.
  return shape(`fill="none" stroke="${edge}" stroke-width="${1.5+2*edgeWidth}"`)+shape(`fill="${outer}" stroke="${outer}" stroke-width="1.5"`)
    +shape(`fill="${inner}" stroke="${edge}" stroke-width="${(edgeWidth/innerScale).toFixed(2)}"`,innerScale);
}
function icon(station:Station) {
  const {stale}=freshness(station,viewTime??Date.now());
  const isSelected=selected?.id===station.id;
  const fill=windColor(station.avg),stroke=windColor(station.gust??station.avg);
  const deg=degrees[station.direction];
  const size=34;
  const shape=arrowShape(deg,fill,stroke);
  const fade=stale&&!isSelected?'opacity-50 hover:opacity-100':'';
  const arrow=`<svg viewBox="-18 -18 36 36" width="${size}" height="${size}" class="block overflow-visible drop-shadow-[0_1px_2px_rgb(0_0_0/0.35)] transition hover:scale-110 ${fade}">${shape}</svg>`;
  const text=`${speed(station.avg)}${station.gust===null?'':`<span class="font-normal text-zinc-500"> / ${speed(station.gust)}</span>`}`;
  const label=`<span class="block rounded-full bg-white/95 font-semibold tabular-nums text-zinc-900 shadow-sm transition ${fade} ${isSelected?'ring-2 ring-blue-600':'ring-1 ring-black/10'} px-1.5 text-[11px] leading-4">${text}</span>`;
  // The label hangs from the station point, 2 px below the arrow.
  return {arrow,label,labelTop:size/2+2};
}
function label(station:Station) {
  return `${station.name} · veter ${speed(station.avg)} m/s · sunki ${speed(station.gust)} m/s · ${station.direction} · ${freshness(station,viewTime??Date.now()).label}`;
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
const placeholders=stationSpots.map(([lat,lon])=>{
  const element=document.createElement('div');
  element.className='pointer-events-none';element.setAttribute('aria-hidden','true');
  element.innerHTML=`<svg viewBox="-18 -18 36 36" width="46" height="46" class="block animate-spin overflow-visible drop-shadow-[0_1px_2px_rgb(0_0_0/0.35)] motion-reduce:animate-none">${arrowShape(0,'#a1a1aa')}</svg>`;
  return new Marker({element}).setLngLat([lon,lat]).addTo(map);
});
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
    const shown=atViewTime(station);
    const {arrow,label:text,labelTop}=icon(shown);
    const element=marker.setLngLat(at).setOffset([offset,0]).getElement();
    const labelElement=labelMarker.setLngLat(at).setOffset([offset,labelTop]).getElement();
    element.innerHTML=arrow;labelElement.innerHTML=text;
    // All arrows above all labels; within each, selected above fresh above stale, so live readings are
    // not hidden by dead stations.
    const rank=selected?.id===station.id?2:freshness(shown,viewTime??Date.now()).stale?0:1;
    element.style.zIndex=String(4+rank);labelElement.style.zIndex=String(1+rank);
    element.setAttribute('title',label(shown));element.setAttribute('aria-label',label(shown));
  }
  hideStations();
}

// ---- Time slider ----
// Shows the arrows at an earlier time, up to trailHours back, from the history the Worker keeps (lib/trail.ts).
// Each station shows its last reading at or before that time; none → a grey dot. The site panel stays current.
let trail:Trail={},viewTime:number|null=null,playing=0;
const slider=$<HTMLInputElement>('time-slider'),play=$('time-play');
slider.min=String(-trailHours*60);
function atViewTime(station:Station):Station {
  if(viewTime===null)return station;
  const reading=(trail[station.id]??[]).findLast(reading=>Date.parse(reading.observedAt??'')<=viewTime!);
  return {...station,...reading??{observedAt:null,avg:null,gust:null,direction:'—'}};
}
// The slider shows once the history covers trailHours. After a deploy it starts empty and fills as
// readings come in; until then it stays hidden, so its range never starts with no data.
const historyFull=()=>Object.values(trail).some(readings=>Date.parse(readings[0].observedAt??'')<=Date.now()-trailHours*3600000);
async function loadTrail() {
  try {const result=await source<Trail>('trail');if(result.data)trail=result.data;}
  catch {/* Without history, past times show grey dots. */}
}
function setTime(minutes:number) {
  slider.value=String(minutes);
  viewTime=minutes<0?Date.now()+minutes*60000:null;
  // How long ago: "pred 1 h 20 min".
  const hours=Math.floor(-minutes/60),rest=-minutes%60;
  $('time-label').textContent=viewTime===null?'zdaj':`pred ${[hours&&`${hours} h`,rest&&`${rest} min`].filter(Boolean).join(' ')}`;
  renderMarkers();
}
const playIcon='<path d="M8 5v14l11-7z" fill="currentColor"/>',pauseIcon='<path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor"/>';
function stop() {
  clearInterval(playing);playing=0;
  play.setAttribute('aria-pressed','false');play.querySelector('svg')!.innerHTML=playIcon;
}
slider.addEventListener('input',async()=>{stop();setTime(Number(slider.value));await loadTrail();renderMarkers();});
// Play: from trailHours back to now in 10-minute steps, half a second each.
play.addEventListener('click',async()=>{
  if(playing){stop();return;}
  play.setAttribute('aria-pressed','true');play.querySelector('svg')!.innerHTML=pauseIcon;
  playing=window.setInterval(()=>{const next=Number(slider.value)+10;setTime(next>=0?0:next);if(next>=0)stop();},500);
  await loadTrail();setTime(-trailHours*60);
});

// ---- Layers: wind, webcams, snow ----
// The map has four layers: wind (default), webcams, snow and rivers; buttons pick the active one and the choice is
// remembered. Only the active layer is shown: with another one active, the wind markers and the time slider hide.
// Webcam and snow markers are buttons like the station labels; tapping one opens it in the panel (see "Panel").
// Their data loads when the layer is first shown.
// - Webcams: all ARSO ones (public/webcams.json, made by scripts/webcams.mjs); a card's images load only when
//   it opens, straight from ARSO.
// - Snow: ARSO's 20 manned stations (Worker source 'snow'): snow depth, new snow and rain as small bar charts.
// - Rivers: ARSO's gauges that measure flow (Worker source 'rivers'): the flow, with a dot for ARSO's rating.
type Layer='wind'|'cameras'|'snow'|'rivers';
interface Webcam {name:string;region:string;location:[number,number];page:string;images:{title:string;url:string}[]}
// Wind: a windsock on its pole. Webcam: round lens on a stand. Snow: a snowflake.
const windPath='<path d="M4 21V3M4 4l17 3.5v3L4 12M9.5 5.1v5.8M15 6.3v3.4"/>';
const cameraPath='<circle cx="12" cy="10" r="7"/><circle cx="12" cy="10" r="2.5"/><path d="M9 16.5 7 21h10l-2-4.5"/>';
const riverPath='<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>';
const snowPath='<path d="M2 12h20M12 2v20M20 16l-4-4 4-4M4 8l4 4-4 4M16 4l-4 4-4-4M8 20l4-4 4 4"/>';
let layer=read<Layer>('layer','wind'),openMarker:Marker|null=null;
// The open marker gets a blue ring, like a selected station's label.
const markerButton=(marker:Marker)=>marker.getElement().firstElementChild as HTMLButtonElement;
function ring(marker:Marker|null,on:boolean) {
  marker&&markerButton(marker).classList.toggle('ring-2',on);marker&&markerButton(marker).classList.toggle('ring-blue-600',on);
}
// A webcam or snow station in the panel: title, a small meta line (HTML) and a body (HTML).
function openCard(marker:Marker,title:string,meta:string,body:string) {
  clearOpen();
  openMarker=marker;ring(marker,true);
  $('site-name').textContent=title;$('site-meta').innerHTML=meta;
  $('site-card').innerHTML=body;
  showContent('card');
  placePanel(marker.getLngLat(),marker.getElement());
  panel.focus({preventScroll:true});
}
// A marker whose look sits on a button inside it: the marker's own element is moved by the map (CSS
// transform). Above the wind markers (z-index 1–6), below the card.
function overlayMarker([lat,lon]:[number,number],className:string,html:string,name:string,onClick:(marker:Marker)=>void) {
  const element=document.createElement('div');element.style.zIndex='7';
  element.innerHTML=`<button type="button" class="cursor-pointer bg-white/95 shadow-sm ring-1 ring-black/10 transition hover:scale-110 ${className}">${html}</button>`;
  const button=element.firstElementChild as HTMLButtonElement;
  button.setAttribute('aria-label',name);button.title=name;
  const marker=new Marker({element}).setLngLat([lon,lat]);
  button.addEventListener('click',event=>{event.stopPropagation();onClick(marker);});
  return marker;
}
const arsoLink=(url:string)=>`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer" class="underline">ARSO</a>`;
async function loadCameras() {
  const list=await (await fetch('/webcams.json')).json() as Webcam[];
  const icon=`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cameraPath}</svg>`;
  return list.map(cam=>overlayMarker(cam.location,'grid size-7 place-items-center rounded-full text-zinc-700 hover:text-black',icon,`Spletna kamera: ${cam.name}`,marker=>{
    // Bust browser caches once a minute so a reopened card shows a fresh image.
    const minute=Math.floor(Date.now()/60000);
    const images=cam.images.map(image=>{
      const url=`${image.url}?t=${minute}`;
      return `<figure><a href="${escape(url)}" target="_blank" rel="noopener noreferrer" class="block"><img src="${escape(url)}" alt="${escape(`${cam.name} · ${image.title}`)}" loading="lazy" class="aspect-video w-full rounded bg-zinc-100 object-cover"></a>
        <figcaption class="mt-1 text-xs text-zinc-500">${escape(image.title)}</figcaption></figure>`;
    }).join('');
    openCard(marker,cam.name,`${arsoLink(cam.page)} · ${escape(cam.region)} · spletna kamera`,`<div class="grid gap-3 py-3">${images}</div>`);
  }));
}
// Each station is a small bar chart of its non-zero readings: snow depth, new snow and rain, each bar with its
// value under it (unit in the title and card). Bar height grows with the square root of the value, full at the
// cap, so small amounts still show. Stations with all readings 0 or missing are left out.
const snowBars=[
  {key:'depth',title:'Snežna odeja',unit:'cm',cap:200,color:'bg-sky-300'},
  {key:'newSnow',title:'Novi sneg',unit:'cm',cap:50,color:'bg-sky-600'},
  {key:'rain',title:'Padavine',unit:'mm',cap:50,color:'bg-blue-900'},
] as const;
async function loadSnow() {
  const {data}=await source<SnowStation[]>('snow');
  if(!data)throw new Error('Snow unavailable');
  const amount=(reading:Reading|null,unit:string)=>reading?`${reading.value} ${unit}${reading.hours?`/${reading.hours} h`:''}`:'—';
  return data.filter(station=>snowBars.some(bar=>station[bar.key]?.value)).map(station=>{
    const bars=snowBars.filter(bar=>station[bar.key]?.value).map(bar=>{
      const {value}=station[bar.key]!,height=Math.max(4,Math.round(48*Math.sqrt(Math.min(value,bar.cap)/bar.cap)));
      return `<span class="flex flex-col items-center gap-0.5"><span class="w-4 rounded-t-sm ${bar.color}" style="height:${height}px"></span>
        <span class="text-xs leading-4 font-semibold tabular-nums">${value}</span></span>`;
    }).join('');
    const name=`${station.name} · ${snowBars.map(bar=>`${bar.title.toLowerCase()} ${amount(station[bar.key],bar.unit)}`).join(' · ')}`;
    return overlayMarker(station.location,'flex items-end gap-1.5 rounded-md px-1.5 pt-1.5 pb-0.5 text-zinc-900',bars,name,marker=>{
      const rows=snowBars.map(bar=>{
        const reading=station[bar.key];
        return `<tr><th class="py-1 pr-3 text-left font-normal text-zinc-500"><span class="mr-1.5 inline-block size-2.5 rounded-sm ${bar.color}"></span>${bar.title}</th>
          <td class="py-1 font-semibold tabular-nums">${amount(reading,bar.unit)}</td><td class="py-1 pl-3 text-right text-xs text-zinc-500">${reading?date(reading.at):''}</td></tr>`;
      }).join('');
      openCard(marker,station.name,`${arsoLink('https://meteo.arso.gov.si/met/sl/weather/observ/surface/snow/')} · padavine in sneg`,
        `<div class="py-1"><table class="w-full text-sm"><tbody class="[&>tr]:border-b [&>tr]:border-zinc-100 [&>tr:last-child]:border-0">${rows}</tbody></table></div>`);
    });
  });
}
// River flow in m³/s: small flows with more decimals. The dot: amber low, blue normal, dark blue high, red at or
// above ARSO's first flood warning level, grey unrated.
const flowText=(n:number)=>n<1?String(+n.toFixed(2)):n<10?n.toFixed(1):String(Math.round(n));
function flowColor({flow,rating,floodFlows}:RiverStation) {
  if(floodFlows.length&&flow>=floodFlows[0])return 'bg-red-600';
  return /mal/.test(rating)?'bg-amber-400':/velik|visok/.test(rating)?'bg-blue-800':rating?'bg-sky-500':'bg-zinc-400';
}
async function loadRivers() {
  const {data}=await source<RiverStation[]>('rivers');
  if(!data)throw new Error('Rivers unavailable');
  const unit=(value:number|null,text:string)=>value===null?'—':`${value} ${text}`;
  return data.map(station=>{
    const color=flowColor(station),flow=`${flowText(station.flow)} m³/s`;
    const label=`<span class="size-2 shrink-0 rounded-full ${color}"></span>${flowText(station.flow)}`;
    const name=`${station.river} · ${station.place} · pretok ${flow}${station.rating?` · ${station.rating}`:''}`;
    return overlayMarker(station.location,'flex items-center gap-1 rounded-full px-1.5 text-xs leading-5 font-semibold tabular-nums whitespace-nowrap text-zinc-900',label,name,marker=>{
      const row=(title:string,value:string,note='')=>`<tr><th class="py-1 pr-3 text-left font-normal text-zinc-500">${title}</th>
        <td class="py-1 font-semibold tabular-nums">${value}</td><td class="py-1 pl-3 text-right text-xs text-zinc-500">${escape(note)}</td></tr>`;
      openCard(marker,`${station.river} · ${station.place}`,`${arsoLink('https://www.arso.gov.si/vode/podatki/amp/')} · vodomerna postaja · ${station.observedAt?escape(date(station.observedAt)):''}`,
        `<div class="py-1"><table class="w-full text-sm"><tbody class="[&>tr]:border-b [&>tr]:border-zinc-100 [&>tr:last-child]:border-0">
          ${row('Pretok',`<span class="mr-1.5 inline-block size-2.5 rounded-full ${color}"></span>${flow}`,station.rating)}
          ${row('Vodostaj',unit(station.level,'cm'))}${row('Temperatura vode',unit(station.temperature,'°C'))}
          ${station.floodFlows.length?row('Opozorilni pretoki',`${station.floodFlows.map(flowText).join(' / ')} m³/s`,'1. / 2. / 3. stopnja'):''}</tbody></table></div>`);
    });
  });
}
// Each extra layer's markers, loaded once on first show.
const overlays:Record<Exclude<Layer,'wind'>,{load:()=>Promise<Marker[]>;task?:Promise<Marker[]>|null;markers:Marker[];error:string}>={
  cameras:{load:loadCameras,markers:[],error:'Spletne kamere niso dosegljive'},
  snow:{load:loadSnow,markers:[],error:'Podatki o snegu niso dosegljivi'},
  rivers:{load:loadRivers,markers:[],error:'Pretoki rek niso dosegljivi'},
};
// Wind markers show only on the wind layer.
function hideStations() {
  for(const marker of [...markers.values(),...labels.values()])marker.getElement().hidden=layer!=='wind';
}
async function showLayer() {
  const shown=layer;
  closePanel();hideStations();
  $('time').classList.toggle('invisible',layer!=='wind');
  for(const [name,overlay] of Object.entries(overlays))if(name!==layer)for(const marker of overlay.markers)marker.remove();
  if(layer==='wind')return;
  const overlay=overlays[layer];
  try {overlay.markers=await (overlay.task??=overlay.load());}
  catch {overlay.task=null;$('map-status').textContent=overlay.error;return;}
  // Unless another layer was picked meanwhile.
  if(layer===shown)for(const marker of overlay.markers)marker.addTo(map);
}
// The layer buttons: on the right edge halfway down on phones (index.astro; the bottom has the search bar),
// bottom right on desktop.
const layerButtons=document.createElement('div');
layerButtons.className='maplibregl-ctrl maplibregl-ctrl-group';
const layers:{id:Layer;name:string;path:string}[]=[{id:'wind',name:'Veter',path:windPath},{id:'cameras',name:'Spletne kamere',path:cameraPath},{id:'snow',name:'Padavine in sneg',path:snowPath},{id:'rivers',name:'Pretoki rek',path:riverPath}];
layerButtons.innerHTML=layers.map(({name,path})=>`<button type="button" title="${name}" aria-label="${name}">
  <svg viewBox="0 0 24 24" width="24" height="24" class="mx-auto" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg></button>`).join('');
const buttons=[...layerButtons.querySelectorAll('button')];
const mark=()=>buttons.forEach((button,i)=>{
  const on=layers[i].id===layer;
  button.setAttribute('aria-pressed',String(on));
  button.classList.toggle('text-blue-600',on);button.classList.toggle('text-zinc-500',!on);
});
mark();
buttons.forEach((button,i)=>button.addEventListener('click',()=>{
  if(layers[i].id===layer)return;
  layer=layers[i].id;save('layer',layer);
  if(layer!=='wind'){stop();setTime(0);}
  mark();void showLayer();
}));
const layerControl={onAdd:()=>layerButtons,onRemove:()=>layerButtons.remove()};
const wide=matchMedia('(min-width: 768px)');
const placeLayerButtons=()=>{if(map.hasControl(layerControl))map.removeControl(layerControl);map.addControl(layerControl,wide.matches?'bottom-right':'top-right');};
placeLayerButtons();wide.addEventListener('change',placeLayerButtons);
void showLayer();

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
    if(result.data){$('site-rose').innerHTML=windRose(result.data,station.roseImage);$('site-rose').hidden=false;}
  } catch {/* The rose is extra; the graph shows the wind. */}
}
function openSite(id:string) {
  const station=stations.find(s=>s.id===id);
  if(!station)return;
  if(selected?.id!==id){history=null;selectedTime=null;$('site-rose').hidden=true;}
  clearOpen();
  selected=station;
  showContent('wind');
  renderHeader();renderMarkers();
  placePanel([station.location![1],station.location![0]],markers.get(id)?.getElement());
  void loadHistory();void loadRose();
  showThanks(station.source);
  const slug=slugs().get(id);
  if(slug)window.history.replaceState(null,'',`#${slug}`);
  // Focus the panel itself (no highlighted button); Tab then reaches the close button.
  panel.focus({preventScroll:true});
}

// ---- Panel ----
// One panel (#site) for whatever was tapped: a wind station (#site-wind) or a webcam or snow station (#site-card).
// Phones: a bottom sheet. Desktop: a bubble above the marker (a MapLibre popup holding the panel element; it goes
// back to its place in the page when closed).
const panel=$('site'),panelHome=$('map-page');
const bubble=new Popup({maxWidth:'none',closeButton:false,closeOnClick:false,focusAfterOpen:false,
  className:'z-10 [&_.maplibregl-popup-content]:rounded-lg! [&_.maplibregl-popup-content]:p-0! [&_.maplibregl-popup-content]:shadow-lg! [&_.maplibregl-popup-content]:ring-1 [&_.maplibregl-popup-content]:ring-black/5'});
bubble.on('close',()=>closePanel());
function showContent(kind:'wind'|'card') {
  $('site-wind').hidden=kind!=='wind';$('site-card').hidden=kind!=='card';$('site-share').hidden=kind!=='wind';
  // Wind graphs need the width; a webcam or snow card is narrower.
  panel.classList.toggle('md:w-[560px]',kind==='wind');panel.classList.toggle('md:w-96',kind==='card');
}
function placePanel(at:[number,number]|{lng:number;lat:number},marker?:HTMLElement) {
  setPanel(true);
  const {clientWidth:width,clientHeight:height}=map.getContainer();
  if(wide.matches) {
    // The map stays; the bubble opens on the side of the marker with more room (above or below; the header
    // covers the top 48 px), shifted sideways near the edges, and is at most as tall as that room.
    const point=map.project(at),offset=(marker?.offsetHeight??20)/2+4,half=panel.offsetWidth/2||280;
    const above=point.y-offset-56,below=height-point.y-offset-8;
    const side=point.x-half<8?'-left':point.x+half>width-8?'-right':'';
    panel.style.maxHeight=`${Math.round(Math.min(Math.max(above,below),innerHeight*0.6))}px`;
    bubble.options.anchor=`${above>=below?'bottom':'top'}${side}` as typeof bubble.options.anchor;
    bubble.setOffset(offset).setLngLat(at);
    if(!bubble.isOpen())bubble.setDOMContent(panel).addTo(map);
  } else {
    // Move the marker above the bottom sheet so it stays visible.
    const point=map.project(at);
    map.panBy([point.x-width/2,point.y-height*0.15]);
  }
}
// What is open (station or card) is closed, but the panel stays: something else opens in it next.
function clearOpen() {
  if(selected){selected=null;++historyRequest;renderMarkers();showThanks(null);}
  ring(openMarker,false);openMarker=null;
}
// Open/close with a slide (up on phones) and fade; on desktop the bubble just appears.
const closedPanel=['invisible','opacity-0','max-md:translate-y-full','md:hidden'];
function setPanel(open:boolean) {for(const name of closedPanel)panel.classList.toggle(name,!open);}
// Under the graph, thanks to the station's data source (its block in #site-thanks).
function showThanks(source:Station['source']|null) {
  for(const block of $('site-thanks').querySelectorAll<HTMLElement>('[data-source]'))block.hidden=block.dataset.source!==source;
}
// returnFocus: when closed from the keyboard, put focus back on the marker.
function closePanel(returnFocus=false) {
  const station=selected?.id,marker=openMarker;
  // Nothing open (also at start-up, before the panel's state below exists).
  if(!station&&!marker)return;
  clearOpen();
  setPanel(false);
  // The bubble's close event calls this again; nothing is open by then.
  if(bubble.isOpen()){bubble.remove();panelHome.appendChild(panel);panel.style.maxHeight='';}
  if(station)window.history.replaceState(null,'',location.pathname+location.search);
  if(returnFocus)(station?markers.get(station)?.getElement():marker&&markerButton(marker))?.focus({preventScroll:true});
}
// detail is 0 when the button is activated from the keyboard.
$('site-close').addEventListener('click',event=>closePanel(event.detail===0));
// Clicking or tapping empty map closes the panel (not a marker or the bubble; drags are not clicks).
map.on('click',event=>{
  if(!(event.originalEvent.target as Element).closest('.maplibregl-marker,.maplibregl-popup'))closePanel();
});
addEventListener('keydown',event=>{if(event.key==='Escape')closePanel(true);});
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

// ---- Links ----
// A site's link is its name without diacritics and without vetr's detail after " - " (/#sv-peter, /#gozd,
// /#potoska-gora). If two stations on the map share a name, the later one by source gets its source added
// (Stol in Kobarid: #stol-skytech).
const sourceOrder=['vetr','skytech','arso','luftar'];
const slugOf=(name:string)=>fold(name).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
function slugs():Map<string,string> {
  const taken=new Set<string>(),result=new Map<string,string>();
  const shown=stations.filter(s=>markers.has(s.id)).sort((a,b)=>sourceOrder.indexOf(a.source)-sourceOrder.indexOf(b.source)||a.id.localeCompare(b.id));
  for(const station of shown) {
    let slug=slugOf(station.name.split(' - ')[0]);
    if(taken.has(slug))slug=`${slug}-${station.source}`;
    taken.add(slug);result.set(station.id,slug);
  }
  return result;
}
// Opens the site named in the address, once the stations are known.
function openLinked():boolean {
  const slug=decodeURIComponent(location.hash.slice(1));
  if(!slug)return true;
  const id=[...slugs()].find(([,s])=>s===slug)?.[0];
  const station=stations.find(s=>s.id===id);
  if(station)pick(station);
  return !!station;
}
let linkPending=true;
addEventListener('hashchange',()=>void openLinked());
$('site-share').addEventListener('click',async()=>{
  const url=location.href,title=selected?.name??'Paraglajzer';
  try {
    if(navigator.share&&matchMedia('(pointer: coarse)').matches)await navigator.share({title,url});
    else {await navigator.clipboard.writeText(url);$('site-share-status').textContent='Povezava kopirana';$('site-share').title='Kopirano';setTimeout(()=>{$('site-share').title='Deli povezavo';$('site-share-status').textContent='';},2000);}
  } catch {/* Share menu closed, or no clipboard access. */}
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
  if($('time').hidden){await loadTrail();$('time').hidden=!historyFull();}
  else if(viewTime!==null)await loadTrail();
  for(const placeholder of placeholders.splice(0))placeholder.remove();
  renderMarkers();
  // A shared link opens its site after the first load (once all four listings are in).
  if(linkPending&&stations.length){linkPending=false;openLinked();}
  if(selected) {
    selected=stations.find(s=>s.id===selected!.id)??selected;
    renderHeader();
    await Promise.all([loadHistory(),loadRose()]);
  }
}
startPolling(update,()=>{renderMarkers();renderHeader();});
