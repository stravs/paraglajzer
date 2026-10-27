export interface WindSample {
  timestamp:string;
  avg:number|null;
  gust:number|null;
  direction:number|null;
}
export function parseVetrHistory(html:string):WindSample[] {
  const match=html.match(/\bpreloadedWindData\s*=\s*(\[[\s\S]*?\])\s*;/);
  if(!match)throw new Error('Wind history missing');
  const rows:unknown=JSON.parse(match[1]);
  if(!Array.isArray(rows))throw new Error('Invalid wind history');
  return chronological(rows.flatMap(row=>{
    if(!row||typeof row.timestamp!=='string')return [];
    const direction=Number.isInteger(row.dir)&&row.dir>=0&&row.dir<8?row.dir*45:null;
    return [{timestamp:row.timestamp,avg:speed(row.avg),gust:speed(row.max),direction}];
  }));
}
export const speed=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
// Drops unparseable times, removes duplicates and sorts oldest first.
export function chronological(rows:WindSample[]):WindSample[] {
  const samples=new Map<number,WindSample>();
  for(const row of rows){
    const time=Date.parse(row.timestamp);if(!Number.isFinite(time))continue;
    samples.set(time,{...row,timestamp:new Date(time).toISOString()});
  }
  const result=[...samples.entries()].sort((a,b)=>a[0]-b[0]).map(([,sample])=>sample);
  if(!result.length)throw new Error('Empty wind history');
  return result;
}
