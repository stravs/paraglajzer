import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVetrHistory,type WindSample } from '../src/lib/history.ts';
import { windCharts,windPath,sampleLabel,sampleReading } from '../src/scripts/wind-charts.ts';
import { sourceFor, parseSkytechHistory } from '../src/lib/sources.ts';

test('Sv. Peter history is chronological and contains weather fields only',()=>{
  const rows=[
    {timestamp:'2026-10-26T12:15:00+01:00',avg:0,max:0,dir:7,phone:'secret'},
    {timestamp:'2026-10-26T12:00:00+01:00',avg:1.2,max:3.4,dir:0},
    {timestamp:'bad',avg:9,max:10,dir:1},
  ];
  const data=parseVetrHistory(`preloadedPrefs = {"private":"secret"}; preloadedWindData = ${JSON.stringify(rows)};`);
  assert.equal(data.length,2);assert.equal(data[0].timestamp,'2026-10-26T11:00:00.000Z');
  assert.equal(data[0].direction,0);assert.equal(data[1].direction,315);
  assert.equal(data[1].avg,0);assert.equal(data[1].gust,0);
  assert.ok(!JSON.stringify(data).includes('secret'));
});
test('invalid measurements remain missing, never converted to calm',()=>{
  const data=parseVetrHistory('preloadedWindData = [{"timestamp":"2026-10-26T12:00:00Z","avg":null,"max":-1,"dir":8}];');
  assert.equal(data[0].avg,null);assert.equal(data[0].gust,null);assert.equal(data[0].direction,null);
  assert.throws(()=>parseVetrHistory('preloadedWindData = [];'));
  assert.throws(()=>parseVetrHistory('no data'));
  assert.throws(()=>parseVetrHistory('preloadedWindData = [window.evil()];'));
});
const samples:WindSample[]=[
  {timestamp:'2026-10-26T12:00:00Z',avg:0,gust:1,direction:315},
  {timestamp:'2026-10-26T12:15:00Z',avg:1,gust:2,direction:0},
];
test('speed lines connect valid readings but not missing readings or gaps',()=>{
  const x=(time:number)=>time-Date.parse(samples[0].timestamp),y=(value:number)=>value;
  assert.ok(windPath(samples,'avg',x,y,1800000).includes('L'));
  assert.ok(!windPath(samples,'avg',x,y,60000).includes('L'));
  const missing=[samples[0],{...samples[1],avg:null}, {...samples[1],timestamp:'2026-10-26T12:30:00Z'}];
  assert.ok(!windPath(missing,'avg',x,y,3600000).includes('L'));
});
test('charts handle calm wind and missing direction without NaN or Infinity',()=>{
  const html=windCharts(samples.map(sample=>({...sample,avg:0,gust:0,direction:null})),1);
  assert.equal((html.match(/data-chart=/g)||[]).length,1);assert.ok(!html.includes('data-history-index'));
  assert.ok(!html.includes('NaN'));assert.ok(!html.includes('Infinity'));
});
test('direction arrows sit in the same chart as speed',()=>{
  const html=windCharts(samples,1);
  assert.equal((html.match(/data-history-index=/g)||[]).length,2);
  assert.equal((html.match(/data-chart=/g)||[]).length,1);
  assert.ok(html.includes('rotate(495)'));
  assert.ok(html.includes('rotate(180)'));
  assert.ok(html.includes('veter iz SZ'));assert.ok(html.includes('veter iz S'));
});
test('chart widens so every direction arrow is shown',()=>{
  const dense=Array.from({length:60},(_,i)=>({timestamp:new Date(Date.parse('2026-10-26T00:00:00Z')+i*600000).toISOString(),avg:1,gust:2,direction:90}));
  const indexes=[...windCharts(dense,3).matchAll(/data-history-index="(\d+)"/g)].map(m=>Number(m[1]));
  assert.equal(indexes.length,60);
});
test('reading spells out direction on its own line, with the same values as the plain label',()=>{
  assert.ok(sampleLabel(samples[1]).endsWith('· Sever'));assert.ok(sampleLabel(samples[0]).endsWith('· Severozahod'));
  // Two lines (speeds, then direction) so the panel height never changes with the direction name.
  const [speeds,direction]=sampleReading(samples[1]).split('\n').map(line=>line.replace(/<[^>]+>/g,'').trim());
  assert.equal(`${speeds} · ${direction.replace('Smer: ','')}`,sampleLabel(samples[1]));
});
test('history endpoints exist per station and share ten-minute caching',()=>{
  assert.equal(sourceFor('history:vetr:peter')?.url,'https://vetr.si/peter');
  assert.equal(sourceFor('history:vetr:peter')?.interval,600);
  assert.equal(sourceFor('history:skytech:9d20c0fee5003106cb0c81fc9a00fc72')?.init?.body,'c=graf&l=9d20c0fee5003106cb0c81fc9a00fc72');
  for(const key of ['history:peter','history:vetr:peter:extra','history:vetr:../x','history:skytech:abc','history:other:x']) assert.equal(sourceFor(key),null,key);
});
const graph=(times:string[],avg:number[],gust:number[],dir:number[])=>`<script>$('#wind_speed').highcharts({xAxis:{categories: [${times.map(t=>`'${t}',`).join('')}]},series:[{data: [${avg.join(',')},]},{data: [${gust.join(',')},]}]});
$('#dir').highcharts({xAxis:{categories: [${times.map(t=>`'${t}',`).join('')}]},yAxis:{categories: ['SZ','Z','JZ','J','JV','V','SV','S','']},series:[{data: [${dir.join(',')},]}]});</script>`;
test('Skytech history is dated from the table time and crosses midnight',()=>{
  const data=parseSkytechHistory(graph(['23:50','00:00','00:10'],[1,2,3],[2,3,4],[3,7,0]),'2026-10-26T23:10:00.000Z');
  assert.deepEqual(data.map(s=>s.timestamp),['2026-10-26T22:50:00.000Z','2026-10-26T23:00:00.000Z','2026-10-26T23:10:00.000Z']);
  assert.deepEqual(data.map(s=>s.direction),[180,0,315]);
  assert.equal(data[2].avg,3);assert.equal(data[2].gust,4);
  // Graph a few minutes newer than the table stays on the same day.
  assert.equal(parseSkytechHistory(graph(['19:47'],[1],[1],[8]),'2026-10-26T18:37:00.000Z')[0].timestamp,'2026-10-26T18:47:00.000Z');
  assert.equal(parseSkytechHistory(graph(['19:47'],[1],[1],[8]),'2026-10-26T18:37:00.000Z')[0].direction,null);
  assert.throws(()=>parseSkytechHistory('<p>changed</p>','2026-10-26T18:37:00.000Z'));
});
