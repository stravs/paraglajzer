import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCandidates, discoverJadralci, regionalCharts, regionalImage, chartRegions, nearestRegion } from '../src/lib/jadralci.ts';

const at=(time:string)=>Date.parse(time);
test('Jadralci model switches at 04 and 16 UTC, including midnight rollover',()=>{
  assert.equal(runCandidates(at('2026-10-26T03:59:00Z'))[0].run,'20261025-1200');
  assert.equal(runCandidates(at('2026-10-26T04:00:00Z'))[0].run,'20261026-0000');
  assert.equal(runCandidates(at('2026-10-26T15:59:00Z'))[0].run,'20261026-0000');
  const latest=runCandidates(at('2026-10-26T16:00:00Z'))[0];
  assert.equal(latest.run,'20261026-1200');
  assert.deepEqual(latest.soundings,['018','024']);
  assert.equal(latest.day,'2026-10-27');
  assert.deepEqual(runCandidates(at('2026-10-26T04:00:00Z'))[0].soundings,['006','012']);
});
test('all 12 regions have all 5 exact ARSO image paths',()=>{
  const run=runCandidates(at('2026-10-26T18:00:00Z'))[0];
  assert.equal(Object.keys(chartRegions).length,12);
  for (const region of Object.keys(chartRegions)) {
    const charts=regionalCharts(run,region); assert.equal(charts.length,5);
    assert.ok(charts.every(chart=>regionalImage(chart.key)?.run===run.run));
  }
  assert.equal(regionalImage('point:20261026-1200:tgrad:LES')?.url,'https://meteo.arso.gov.si/uploads/probase/www/model/aladin/point/as_20261026-1200_tgrad_SILES.png');
  assert.equal(regionalImage('point:20261026-1200:pstemp-018:LES')?.url,'https://meteo.arso.gov.si/uploads/probase/www/model/aladin/point/as_20261026-1200_SILES_pstemp_018.png');
  assert.equal(regionalCharts(run,'LES')[3].validAt,'2026-10-27T06:00:00.000Z');
  for (const key of ['point:20261026-1100:tgrad:LES','point:20261026-1200:evil:LES','point:20261026-1200:tgrad:BAD','point:20261026-1200:pstemp-999:LES','point:20261026-1200:tgrad:LES:extra']) assert.equal(regionalImage(key),null);
});
test('discovery falls back only after a missing run and validates bulletin content',async()=>{
  const urls:string[]=[];
  const fetcher=(async(url:RequestInfo|URL)=>{
    urls.push(String(url));
    return urls.length===1 ? new Response('',{status:404}) : new Response('"1" "LES" "1300" "1" "0.3"');
  }) as typeof fetch;
  const run=await discoverJadralci(at('2026-10-26T18:00:00Z'),fetcher);
  assert.equal(run.run,'20261026-0000');assert.deepEqual(run.soundings,['030','036']);assert.equal(urls.length,2);
  await assert.rejects(()=>discoverJadralci(at('2026-10-26T18:00:00Z'),(async()=>new Response('<html>not data</html>')) as typeof fetch));
});
test('provider failures do not cause fallback request storms',async()=>{
  let count=0;
  await assert.rejects(()=>discoverJadralci(at('2026-10-26T18:00:00Z'),(async()=>{count++;return new Response('',{status:503});}) as typeof fetch));
  assert.equal(count,1);
});
test('sites use the nearest Jadralci region',()=>{
  assert.equal(nearestRegion([46.383,14.193]),'LES'); // Sv. Peter
  assert.equal(nearestRegion([46.273,13.473]),'BOV'); // Stol (Kobarid)
  assert.equal(nearestRegion([46.263,15.742]),'PTU'); // Donačka gora
  assert.equal(nearestRegion([45.960,13.720]),'NGO'); // Lijak
});
