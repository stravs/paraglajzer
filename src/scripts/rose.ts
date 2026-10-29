import { roseBands,roseColors,roseSectors,type WindRose } from '../lib/rose';
import { clock } from './wind-charts';
import { escape } from './weather';

// Draws the vetr.si wind rose as SVG in vetr.si's look: rings, stacked speed bands per sector (petals point
// to where the wind comes from), a calm circle in the middle and S/V/J/Z labels on dark discs. Below it, the
// share of each speed band as bars, as on vetr.si. Behind the rose, vetr.si's aerial photo of the site, if any.
const R=130,calmR=R*0.06,step=360/roseSectors;
const point=(r:number,degrees:number)=>{const a=degrees*Math.PI/180;return `${(r*Math.sin(a)).toFixed(1)},${(-r*Math.cos(a)).toFixed(1)}`;};
const label=(text:string,degrees:number)=>{const [x,y]=point(R+22,degrees).split(',');return `<circle cx="${x}" cy="${y}" r="12" fill="rgba(0,0,0,0.7)"/><text x="${x}" y="${y}" dy="0.35em" text-anchor="middle" font-size="13" font-weight="700" fill="#8990aa">${text}</text>`;};
export function windRose(rose:WindRose,image?:string):string {
  const pct=(count:number)=>count*100/rose.total;
  const totals=rose.counts.map(bands=>pct(bands.reduce((a,b)=>a+b,0)));
  const scale=(R-calmR)/Math.max(12,Math.ceil(Math.max(...totals)));
  const rings=Array.from({length:6},(_,i)=>`<circle r="${(R*(i+1)/6).toFixed(1)}" fill="none" stroke="#e4e4e7"/>`).join('');
  const spokes=Array.from({length:roseSectors},(_,s)=>`<path d="M${point(calmR,(s+0.5)*step)}L${point(R,(s+0.5)*step)}" stroke="rgba(180,190,216,0.57)"/>`).join('');
  const petals=rose.counts.flatMap((bands,s)=>{
    let inner=calmR;
    return bands.map((count,band)=>{
      if(!count)return '';
      const outer=inner+pct(count)*scale,a0=(s-0.5)*step,a1=(s+0.5)*step;
      const path=`<path d="M${point(inner,a0)}L${point(inner,a1)}L${point(outer,a1)}L${point(outer,a0)}Z" fill="${roseColors[band]}" fill-opacity="0.92"/>`;
      inner=outer;return path;
    });
  }).join('');
  const svg=`<svg viewBox="-166 -166 332 332" class="relative mx-auto block w-full max-w-72" role="img" aria-label="Vetrna roža: od kod je pihal veter v zadnji uri">${rings}${petals}${spokes}<circle r="${calmR.toFixed(1)}" fill="none" stroke="rgb(168,168,168)" stroke-width="2"/>${label('S',0)}${label('V',90)}${label('J',180)}${label('Z',270)}</svg>`;
  // Legend: calm, then each band (0 – 1, 1 – 2 … 10 +), with its share as a bar.
  const shares=[rose.calm,...roseBands.concat(Infinity).map((_,band)=>rose.counts.reduce((sum,bands)=>sum+bands[band],0))].map(pct);
  const names=['0',...roseBands.map((limit,i)=>`${i?roseBands[i-1]:0} – ${limit}`),`${roseBands.at(-1)} +`];
  const legend=shares.map((share,i)=>`<div class="flex w-9 flex-col items-center"><span class="text-[9px] text-zinc-500">${Math.round(share)}%</span><span class="block w-full rounded-sm" style="height:${(3+share*0.6).toFixed(1)}px;background:${i?roseColors[i-1]:'black'}"></span><span class="mt-1 text-[9px] font-semibold text-zinc-700">${names[i]}</span></div>`).join('');
  return `<h3 class="mb-1 text-sm font-semibold">Vetrna roža</h3><p class="mb-2 text-xs text-zinc-500">${clock(rose.from)}–${clock(rose.to)}</p>${image?`<div class="relative overflow-hidden rounded-2xl border border-zinc-200"><img src="${escape(image)}" alt="" class="absolute inset-0 size-full object-cover">${svg}</div>`:svg}
    <div class="mt-3 flex items-end justify-center gap-1"><div class="flex flex-col items-end pr-1 text-[10px] text-zinc-500"><span>%</span><span class="mt-1">m/s</span></div>${legend}</div>`;
}
