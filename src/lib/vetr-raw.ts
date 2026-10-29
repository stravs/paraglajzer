// Our own "now" for a vetr station, from its raw readings (one every 5 s, sent every 10 min): the 10 min up
// to the newest reading. vetr.si's own "now" is its newest 15-min window, which right after some sends
// holds only seconds of data.
export interface VetrRaw {
  from: string; to: string; samples: number;
  avg: number;
  // Gust: the highest reading. Each covers 5 s, the closest to the WMO standard (highest 3-s average).
  gust: number;
  // Degrees the wind comes from, averaged with each reading weighted by its speed.
  direction: number | null;
}
export function parseVetrRaw(body: string): VetrRaw {
  const data = JSON.parse(body);
  if (!Array.isArray(data?.winds) || !Array.isArray(data?.dirs)) throw new Error('Raw wind data missing');
  const speeds = new Map<number, number>();
  for (const row of data.winds) {
    const time = Date.parse(row?.timestamp), value = row?.value;
    if (Number.isFinite(time) && typeof value === 'number' && Number.isFinite(value) && value >= 0) speeds.set(time, value);
  }
  if (!speeds.size) throw new Error('Empty raw wind data');
  const to = Math.max(...speeds.keys()), from = to - 600000;
  const window = [...speeds].filter(([time]) => time > from).map(([, value]) => value);
  let x = 0, y = 0;
  for (const row of data.dirs) {
    const time = Date.parse(row?.timestamp), speed = speeds.get(time);
    if (!(time > from) || speed === undefined || typeof row?.value !== 'number') continue;
    x += speed * Math.cos(row.value * Math.PI / 180); y += speed * Math.sin(row.value * Math.PI / 180);
  }
  return {
    from: new Date(from).toISOString(), to: new Date(to).toISOString(), samples: window.length,
    avg: window.reduce((sum, value) => sum + value, 0) / window.length, gust: Math.max(...window),
    direction: Math.hypot(x, y) > 0 ? Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360) % 360 : null,
  };
}
