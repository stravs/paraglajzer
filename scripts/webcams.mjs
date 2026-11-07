// Builds public/webcams.json: every ARSO webcam. Run now and then: node scripts/webcams.mjs
import { writeFile } from 'node:fs/promises';

const ARSO = 'https://meteo.arso.gov.si';
const get = async (url, type = 'text') => {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return await response[type]();
    } catch (error) { if (attempt === 2) throw error; console.log(`  retrying ${url}: ${error.message}`); await new Promise(r => setTimeout(r, 5000)); }
  }
};
// Runs fn on every item, a few at a time.
async function each(items, limit, fn) {
  const results = []; let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); } }));
  return results;
}
const round = n => +n.toFixed(5);

// ---- ARSO ----
// One list has the cameras and their view directions; each direction's image series names the camera's folder.
// Directions without recent images (camera offline) are left out.
const compass = { n:'S', ne:'SV', e:'V', se:'JV', s:'J', sw:'JZ', w:'Z', nw:'SZ' };
async function arso() {
  const { webcam_list: list } = await get('https://vreme.arso.gov.si/api/1.0/webcam_list/', 'json');
  const cams = await each(list.features, 4, async ({ geometry, properties: p }) => {
    const images = (await each(p.directions, 2, async direction => {
      const series = await get(`${ARSO}/uploads/probase/www/observ/webcam/json/sl/webcam_${p.id}${direction}_data.json`, 'json');
      const folder = series.at(-1)?.path.match(/webcam\/([^/]+)_dir\//)?.[1];
      return folder && { title: `Proti ${compass[direction] ?? direction}`, url: `${ARSO}/uploads/probase/www/observ/webcam/${folder}_dir/siwc_${folder}_${direction}.jpg` };
    })).filter(Boolean);
    const [lon, lat] = geometry.coordinates;
    return images.length && { name: p.title, region: p.parent_title, location: [round(lat), round(lon)], page: 'https://vreme.arso.gov.si/', images };
  });
  return cams.filter(Boolean);
}

const cams = await arso();
// One camera per line, so a refresh reads well in a diff.
await writeFile(new URL('../public/webcams.json', import.meta.url), `[\n${cams.map(cam => JSON.stringify(cam)).join(',\n')}\n]\n`);
console.log(`${cams.length} webcams → public/webcams.json`);
