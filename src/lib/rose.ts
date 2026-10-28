// vetr.si wind rose ("Vetrna roža"), counted as on vetr.si: its raw readings (one per 5 s) of the last hour, in
// 24 direction sectors of 15° (the first centred on north, by where the wind comes from) and speed bands.
// Calm readings (0 m/s) are counted apart.
export const roseSectors = 24;
// Upper limits of the speed bands in m/s; the last band is above 10. Colours as on vetr.si, calm black.
export const roseBands = [1, 2, 4, 6, 8, 10];
export const roseColors = ['rgb(70, 127, 197)', 'rgb(55, 176, 123)', 'rgb(83, 222, 71)', 'rgb(170, 255, 58)', 'rgb(255, 235, 58)', 'rgb(255, 176, 58)', 'rgb(249, 37, 37)'];
export interface WindRose {
  from: string; to: string; total: number; calm: number;
  // counts[sector][band]
  counts: number[][];
}
type Reading = { timestamp?: unknown; value?: unknown };
export function parseVetrRose(body: string): WindRose {
  const data = JSON.parse(body) as { dirs?: Reading[]; winds?: Reading[] };
  if (!Array.isArray(data.dirs) || !Array.isArray(data.winds)) throw new Error('Wind rose data missing');
  // Directions and speeds come as two lists with the same timestamps.
  const speeds = new Map(data.winds.map(w => [w.timestamp, w.value]));
  const counts = Array.from({ length: roseSectors }, () => new Array(roseBands.length + 1).fill(0));
  let calm = 0, total = 0, from = Infinity, to = -Infinity;
  for (const { timestamp, value: dir } of data.dirs) {
    const speed = speeds.get(timestamp), time = Date.parse(String(timestamp));
    if (typeof dir !== 'number' || typeof speed !== 'number' || !Number.isFinite(dir) || !Number.isFinite(speed) || speed < 0 || !Number.isFinite(time)) continue;
    total++; from = Math.min(from, time); to = Math.max(to, time);
    if (speed === 0) { calm++; continue; }
    const band = roseBands.findIndex(limit => speed <= limit);
    counts[Math.round((((dir % 360) + 360) % 360) / (360 / roseSectors)) % roseSectors][band < 0 ? roseBands.length : band]++;
  }
  if (!total) throw new Error('Empty wind rose');
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), total, calm, counts };
}
