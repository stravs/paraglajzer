const POINT = 'https://meteo.arso.gov.si/uploads/probase/www/model/aladin/point/';
export const chartRegions = {
  LES:'Gorenjska', LJU:'Osrednja Slovenija', CEL:'Zahodna Štajerska', MSO:'Pomurje',
  NMO:'Dolenjska', NGO:'Zahodna Primorska', BOV:'Posočje', POS:'Vzhodna Primorska',
  POR:'Obala', KOC:'Notranjska', PTU:'Vzhodna Štajerska', SGR:'Koroška',
} as const;
// ARSO thermal forecasts (RSS) exist for 6 regions. Each Jadralci region uses the one it belongs to by
// name, so Napoved needs a single region picker.
export const thermalRegions = { LES:'Gorenjska', NGO:'Primorska', LJU:'Osrednja', NMO:'Dolenjska', CEL:'Štajerska', MSO:'Pomurska' } as const;
export const thermalRegionFor:Record<keyof typeof chartRegions,keyof typeof thermalRegions> = {
  LES:'LES', LJU:'LJU', CEL:'CEL', MSO:'MSO', NMO:'NMO', NGO:'NGO',
  BOV:'NGO', POS:'NGO', POR:'NGO', KOC:'LJU', PTU:'CEL', SGR:'CEL',
};
// ARSO forecast point behind each region code (Lesce, Ljubljana, Celje, …).
const chartPoints:Record<keyof typeof chartRegions,[number,number]> = {
  LES:[46.36,14.17], LJU:[46.06,14.51], CEL:[46.24,15.27], MSO:[46.66,16.17],
  NMO:[45.80,15.17], NGO:[45.96,13.65], BOV:[46.34,13.55], POS:[45.78,14.21],
  POR:[45.51,13.59], KOC:[45.64,14.86], PTU:[46.42,15.87], SGR:[46.51,15.08],
};
export function nearestRegion([lat,lon]:[number,number]):keyof typeof chartRegions {
  const distance=([a,b]:[number,number])=>(a-lat)**2+((b-lon)*Math.cos(lat*Math.PI/180))**2;
  return (Object.keys(chartPoints) as (keyof typeof chartRegions)[]).reduce((best,code)=>distance(chartPoints[code])<distance(chartPoints[best])?code:best);
}
export interface JadralciRun { run:string; runAt:string; day:string; soundings:string[]; }
export interface RegionalChart { key:string; title:string; validAt?:string; }

// Jadralci switches to the 00 UTC run at 04 UTC and the 12 UTC run at 16 UTC.
export function runCandidates(now=Date.now()):JadralciRun[] {
  const hour=3600000;
  const latest=Math.floor((now-4*hour)/(12*hour))*12*hour;
  const day=new Date(now);
  day.setUTCHours(0,0,0,0);
  if (new Date(now).getUTCHours()>=16) day.setUTCDate(day.getUTCDate()+1);
  return Array.from({length:4},(_,index)=>{
    const timestamp=latest-index*12*hour;
    const runAt=new Date(timestamp).toISOString();
    const firstLead=(day.getTime()+6*hour-timestamp)/hour;
    return {
      run:runAt.slice(0,10).replaceAll('-','')+'-'+runAt.slice(11,13)+'00', runAt,
      day:day.toISOString().slice(0,10),
      soundings:[firstLead,firstLead+6].map(lead=>String(lead).padStart(3,'0')),
    };
  }).filter(run=>run.soundings.every(lead=>Number(lead)>=6 && Number(lead)<=48));
}
export async function discoverJadralci(now=Date.now(),fetcher:typeof fetch=fetch):Promise<JadralciRun> {
  for (const candidate of runCandidates(now)) {
    const response=await fetcher(`${POINT}as_${candidate.run}_cbase_d1.txt`,{
      headers:{'User-Agent':'Paraglajzer/0.1 (shared weather cache)'},signal:AbortSignal.timeout(8000),
    });
    if (response.status===404) continue;
    if (!response.ok) throw new Error(`ARSO model discovery HTTP ${response.status}`);
    const text=await response.text();
    if (!/"LES"\s+"[\d.]+"/.test(text)) throw new Error('Invalid ARSO model bulletin');
    return candidate;
  }
  throw new Error('No available Jadralci model run in the last 48 hours');
}
export function regionalCharts(run:JadralciRun,region:string):RegionalChart[] {
  if (!Object.hasOwn(chartRegions,region)) return [];
  const chart=(product:string,title:string):RegionalChart=>({key:`point:${run.run}:${product}:${region}`,title});
  return [
    chart('tgrad','Temperaturni gradient'),
    chart('rh-va','Relativna vlažnost / oblačnost'),
    chart('vm-va','Veter'),
    ...run.soundings.map(lead=>({
      ...chart(`pstemp-${lead}`,'Napovedana sondaža'),
      validAt:new Date(Date.parse(run.runAt)+Number(lead)*3600000).toISOString(),
    })),
  ];
}
export function regionalImage(key:string):{url:string;run:string} | null {
  const match=key.match(/^point:(\d{8}-(?:0000|1200)):(tgrad|rh-va|vm-va|pstemp-(?:006|012|018|024|030|036|042|048)):([A-Z]{3})$/);
  if (!match || !Object.hasOwn(chartRegions,match[3])) return null;
  const [,run,product,region]=match;
  const suffix=product.startsWith('pstemp-') ? `SI${region}_pstemp_${product.slice(7)}` : `${product}_SI${region}`;
  return {url:`${POINT}as_${run}_${suffix}.png`,run};
}
