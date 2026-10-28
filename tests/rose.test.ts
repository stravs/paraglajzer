import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVetrRose } from '../src/lib/rose.ts';
import { sourceFor } from '../src/lib/sources.ts';

test('vetr wind rose counts readings by direction sector and speed band, calm apart',()=>{
  const at=(s:number)=>`2026-10-28T18:00:${String(s).padStart(2,'0')}+01:00`;
  const body=JSON.stringify({
    dirs:[{timestamp:at(0),value:356},{timestamp:at(5),value:5},{timestamp:at(10),value:90},{timestamp:at(15),value:200},{timestamp:at(20),value:45}],
    winds:[{timestamp:at(0),value:0.5},{timestamp:at(5),value:1.5},{timestamp:at(10),value:12},{timestamp:at(15),value:0},{timestamp:at(20),value:null}],
  });
  const rose=parseVetrRose(body);
  assert.equal(rose.total,4); // the reading without a speed is skipped
  assert.equal(rose.calm,1);
  assert.deepEqual(rose.counts[0],[1,1,0,0,0,0,0]); // 356° and 5° are both north (sector centred on 0°)
  assert.equal(rose.counts[6][6],1); // 90° east, above 10 m/s
  assert.equal(rose.from,'2026-10-28T17:00:00.000Z');assert.equal(rose.to,'2026-10-28T17:00:15.000Z');
  assert.throws(()=>parseVetrRose('{}'));
});
test('Wind rose source asks vetr.si for the last hour only, for a plain station id',()=>{
  assert.equal(sourceFor('rose:vetr:peter')?.url,'https://vetr.si/peter/data/wind_all.json?duration=1');
  assert.equal(sourceFor('rose:vetr:../x'),null);
});
