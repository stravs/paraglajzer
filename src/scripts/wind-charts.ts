import type { WindSample } from '../lib/history';
const clock=(timestamp:string)=>new Intl.DateTimeFormat('sl-SI',{timeZone:'Europe/Ljubljana',hour:'2-digit',minute:'2-digit'}).format(new Date(timestamp));
const compass=['S','SV','V','JV','J','JZ','Z','SZ','S'];
const directions=['Sever','Severovzhod','Vzhod','Jugovzhod','Jug','Jugozahod','Zahod','Severozahod'];
const speed=(value:number|null)=>value===null?'—':value.toFixed(1);
// ARSO gives exact degrees; vetr and Skytech give multiples of 45. Names use the nearest of 8 points.
const point=(degrees:number)=>Math.round(degrees/45)%8;
const directionName=(sample:WindSample)=>sample.direction===null?'—':directions[point(sample.direction)];
export function sampleLabel(sample:WindSample):string {
  return `${clock(sample.timestamp)} · veter ${speed(sample.avg)} m/s · sunki ${speed(sample.gust)} m/s · ${directionName(sample)}`;
}
// Same text as sampleLabel, with the values emphasized. Only numbers and fixed words, so safe as HTML.
// Always two lines (speeds, then direction), so moving the slider never changes its height: direction
// names range from "Jug" to "Severozahod", and on narrow screens the long ones used to wrap.
export function sampleReading(sample:WindSample):string {
  return `<span class="block whitespace-nowrap"><span class="font-semibold">${clock(sample.timestamp)}</span> · veter <span class="font-semibold">${speed(sample.avg)}</span> m/s · sunki <span class="font-semibold">${speed(sample.gust)}</span> m/s</span>
    <span class="block">Smer: <span class="font-semibold">${directionName(sample)}</span></span>`;
}
export function windPath(samples:WindSample[],field:'avg'|'gust',x:(time:number)=>number,y:(value:number)=>number,maxGap:number):string {
  let path='',previous:WindSample|null=null;
  for(const sample of samples){
    const value=sample[field];
    if(value===null){previous=null;continue;}
    const previousValue=previous?.[field];
    const gap=previous?Date.parse(sample.timestamp)-Date.parse(previous.timestamp):Infinity;
    path+=`${previousValue!=null&&gap<=maxGap?'L':'M'}${x(Date.parse(sample.timestamp)).toFixed(1)},${y(value).toFixed(1)} `;
    previous=sample;
  }
  return path.trim();
}
export function windCharts(samples:WindSample[],selected:number,available=400):string {
  if(!samples.length)return '';
  const start=Date.parse(samples[0].timestamp),end=Date.parse(samples.at(-1)!.timestamp);
  const span=Math.max(end-start,1);
  const intervals=samples.slice(1).map((sample,index)=>Date.parse(sample.timestamp)-Date.parse(samples[index].timestamp)).filter(n=>n>0).sort((a,b)=>a-b);
  const maxGap=Math.max(30*60000,(intervals[Math.floor(intervals.length/2)]||15*60000)*2.5);
  // Fill the available width (38px axis + 16px padding), but widen so the closest readings are 18px apart and every arrow fits.
  const plot=Math.max(available-54,intervals.length?span/intervals[0]*18:0),width=plot+16;
  const x=(time:number)=>8+(time-start)/span*plot;
  const maximum=Math.max(1,...samples.flatMap(sample=>[sample.avg||0,sample.gust||0]));
  const rawStep=maximum/4,power=10**Math.floor(Math.log10(rawStep));
  const step=([1,2,5,10].find(n=>n*power>=rawStep)||10)*power;
  const top=Math.ceil(maximum/step)*step;
  const active=samples[Math.max(0,Math.min(selected,samples.length-1))];
  const y=(value:number)=>16+(1-value/top)*136;
  const ticks=Array.from({length:Math.round(top/step)+1},(_,i)=>i*step);
  const grid=ticks.map(value=>`<line x1="8" x2="${8+plot}" y1="${y(value)}" y2="${y(value)}" stroke="#e4e4e7"/>`).join('');
  const labels=ticks.map(value=>`<text x="31" y="${y(value)+4}" text-anchor="end" fill="#71717a" font-size="10">${Number(value.toFixed(2))}</text>`).join('');
  const count=Math.max(2,Math.floor(plot/90)+1);
  const times=Array.from({length:count},(_,i)=>{
    const time=start+span*i/(count-1);
    return `<text x="${x(time)}" y="202" text-anchor="${i===0?'start':i===count-1?'end':'middle'}" fill="#71717a" font-size="10">${clock(new Date(time).toISOString())}</text>`;
  }).join('');
  const series=(['gust','avg'] as const).map(key=>{
    const color=key==='gust'?'#a1a1aa':'#27272a';
    const path=windPath(samples,key,x,y,maxGap);
    const dots=samples.filter(sample=>sample[key]!==null).map(sample=>`<circle cx="${x(Date.parse(sample.timestamp))}" cy="${y(sample[key]!)}" r="2" fill="${color}"><title>${sampleLabel(sample)}</title></circle>`).join('');
    return `<path d="${path}" fill="none" stroke="${color}" stroke-width="1.5" ${key==='gust'?'stroke-dasharray="4 3"':''}/>${dots}`;
  }).join('');
  const activeX=x(Date.parse(active.timestamp));
  const selectedDots=(['gust','avg'] as const).map(key=>active[key]===null?'':`<circle cx="${activeX}" cy="${y(active[key]!)}" r="3.5" fill="${key==='gust'?'#a1a1aa':'#27272a'}" stroke="white" stroke-width="1"/>`).join('');
  const arrows=samples.map((sample,index)=>{
    if(sample.direction===null)return '';
    const px=x(Date.parse(sample.timestamp)),selected=sample===active;
    return `<g data-history-index="${index}" class="cursor-pointer"><title>${clock(sample.timestamp)} · veter iz ${compass[point(sample.direction)]}</title><rect x="${(px-9).toFixed(1)}" y="164" width="18" height="22" fill="transparent"/><g transform="translate(${px.toFixed(1)} 175) rotate(${sample.direction+180})" fill="none" stroke="${selected?'#2563eb':'#27272a'}" stroke-width="${selected?2.5:2}" stroke-linecap="round" stroke-linejoin="round"><path d="M0 8V-8M-5 -3L0 -8 5 -3"/></g></g>`;
  }).join('');
  const axis=`<svg aria-hidden="true" viewBox="0 0 38 210" width="38" height="210" class="shrink-0">${labels}<text x="31" y="179" text-anchor="end" fill="#71717a" font-size="10">smer</text></svg>`;
  const chart=`<svg data-chart="wind" role="img" aria-label="Hitrost, sunki in smer vetra skozi čas; puščice kažejo, kam piha" viewBox="0 0 ${width.toFixed(0)} 210" width="${width.toFixed(0)}" height="210" class="max-w-none"><title>Hitrost, sunki (m/s) in smer vetra</title>${grid}<line x1="8" x2="${8+plot}" y1="175" y2="175" stroke="#f4f4f5"/>${times}<line x1="${activeX}" x2="${activeX}" y1="16" y2="186" stroke="#a1a1aa" stroke-dasharray="2 3"/>${series}${selectedDots}${arrows}</svg>`;
  return `<figure><figcaption class="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs"><span class="font-medium">Veter · m/s in smer</span><span class="text-zinc-500"><span class="text-zinc-900">━ povprečje</span> &nbsp;┄ sunki</span></figcaption><div class="flex">${axis}<div data-wind-scroll data-selected-x="${activeX.toFixed(0)}" class="min-w-0 overflow-x-auto overscroll-x-contain">${chart}</div></div></figure>`;
}
