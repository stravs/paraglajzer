import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addReadings, fakeTrail } from '../src/lib/trail.ts';
import type { Station } from '../src/lib/sources.ts';

const station = (observedAt: string | null, avg = 3): Station => ({id:'vetr-a', name:'A', region:'', source:'vetr', url:'', avg, gust:avg+2, direction:'J', observedAt, interval:10, note:'', location:null});
const now = Date.parse('2026-10-30T12:00:00Z');

test('history adds new readings once and drops ones older than 4 h (3 h slider + 1 h)', () => {
  let trail = addReadings({}, [station('2026-10-30T07:50:00Z')], now);
  assert.deepEqual(trail, {});
  trail = addReadings(trail, [station('2026-10-30T11:40:00Z', 2)], now);
  trail = addReadings(trail, [station('2026-10-30T11:40:00Z', 2)], now);
  trail = addReadings(trail, [station('2026-10-30T11:50:00Z', 4)], now);
  assert.deepEqual(trail['vetr-a'].map(r => r.avg), [2, 4]);
  assert.deepEqual(addReadings(trail, [station(null)], now + 4*3600000), {});
});

test('fake history ends at the current reading and is the same each time', () => {
  const trail = fakeTrail([station('2026-10-30T11:50:00Z'), {...station(null), id:'vetr-b'}]);
  const readings = trail['vetr-a'];
  assert.equal(readings.length, 19);
  assert.deepEqual(readings.at(-1), {observedAt:'2026-10-30T11:50:00.000Z', avg:3, gust:5, direction:'J'});
  assert.equal(readings[0].observedAt, '2026-10-30T08:50:00.000Z');
  assert.ok(readings.every(r => r.avg! >= 0 && r.gust! >= r.avg!));
  assert.equal(trail['vetr-b'], undefined);
  assert.deepEqual(fakeTrail([station('2026-10-30T11:50:00Z')]), {'vetr-a':readings});
});
