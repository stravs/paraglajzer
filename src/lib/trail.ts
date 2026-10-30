import type { Station } from './sources.ts';

// Recent readings of every station, oldest first, so the map can show the wind at an earlier time.
// The Worker records each new listing reading; no extra requests to the providers.
export type Reading = Pick<Station, 'observedAt' | 'avg' | 'gust' | 'direction'>;
export type Trail = Record<string, Reading[]>;
// The slider goes trailHours back. One extra hour is kept, so even at the far end each station has its last
// reading from before that time (ARSO only reports every 30 min).
export const trailHours = 3;
const keptHours = trailHours + 1;

// Adds each station's reading if it is new and drops readings older than keptHours.
export function addReadings(trail: Trail, stations: Station[], now = Date.now()): Trail {
  const cutoff = now - keptHours*3600000, result: Trail = {};
  for (const station of stations) {
    const readings = (trail[station.id] ?? []).filter(reading => Date.parse(reading.observedAt ?? '') >= cutoff);
    const time = Date.parse(station.observedAt ?? '');
    const last = Date.parse(readings.at(-1)?.observedAt ?? '');
    if (time >= cutoff && !(time <= last)) {
      readings.push({observedAt:station.observedAt, avg:station.avg, gust:station.gust, direction:station.direction});
    }
    if (readings.length) result[station.id] = readings;
  }
  return result;
}

// Dev only (FAKE_DATA=1): a made-up history leading to each station's current reading, every 10 min.
// Seeded by station id, so it stays the same until the reading changes.
const compass = ['S','SV','V','JV','J','JZ','Z','SZ'];
export function fakeTrail(stations: Station[]): Trail {
  const trail: Trail = {};
  for (const station of stations) {
    const end = Date.parse(station.observedAt ?? '');
    if (!Number.isFinite(end)) continue;
    const random = seeded(station.id);
    const round = (n: number) => Math.round(Math.max(0, n)*10)/10;
    let {avg, gust} = station, point = compass.indexOf(station.direction);
    const readings: Reading[] = [];
    for (let step = 0; step <= trailHours*6; step++) {
      readings.unshift({observedAt:new Date(end - step*600000).toISOString(), avg, gust, direction:point < 0 ? station.direction : compass[point]});
      if (avg !== null) avg = round(avg + (random() - 0.5)*1.5);
      if (gust !== null) gust = Math.max(avg ?? 0, round(gust + (random() - 0.5)*2));
      if (point >= 0 && random() < 0.25) point = (point + (random() < 0.5 ? 7 : 1)) % 8;
    }
    trail[station.id] = readings;
  }
  return trail;
}
function seeded(text: string) {
  let state = [...text].reduce((hash, c) => Math.imul(hash ^ c.charCodeAt(0), 16777619), 2166136261);
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
