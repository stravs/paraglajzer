import { test,expect } from '@playwright/test';
const base=process.env.TEST_URL||'http://172.17.0.2:4324';
test('Postaje: compact m/s table, search, saved stations, no forecast fetches',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const errors:string[]=[],keys:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/source')keys.push(url.searchParams.get('key')||'');});
  await page.goto(`${base}/postaje/`);
  await expect(page.locator('#stations')).toHaveAttribute('aria-busy','false',{timeout:45000});
  expect(await page.locator('[data-save]').count()).toBeGreaterThan(0);
  await expect(page.locator('thead')).toContainText('m/s');
  await expect(page.locator('body')).not.toContainText('km/h');
  // Postaje is not in the navigation (reached by URL); the nav has Zemljevid and Napoved.
  await expect(page.locator('nav a')).toHaveCount(2);
  await expect(page.getByRole('link',{name:'Postaje',exact:true})).toHaveCount(0);
  await page.locator('[data-save]').first().click();
  await page.selectOption('#source-filter','favorites');
  await expect(page.locator('[data-save]')).toHaveCount(1);
  await page.selectOption('#source-filter','all');
  await page.locator('#search').fill('xyz nonexistent');await expect(page.locator('#stations')).toContainText('Ni postaj.');
  await page.locator('#search').fill('');expect(await page.locator('[data-save]').count()).toBeGreaterThan(0);
  for(const width of [390,768]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  expect(keys).toEqual(expect.arrayContaining(['stations']));expect(keys.every(key=>key==='stations')).toBe(true);
  expect(errors).toEqual([]);
});
test('concurrent source requests reuse the same global check',async({request})=>{
  const responses=await Promise.all(Array.from({length:8},()=>request.get(`${base}/api/source?key=vetr`)));
  const data=await Promise.all(responses.map(response=>response.json()));
  expect(data[0].data.length).toBeGreaterThan(0);
  expect(new Set(data.map(snapshot=>snapshot.checkedAt)).size).toBe(1);
  // Next checks fall on 10-minute clock marks, at least half an interval after the last check.
  expect(data[0].nextCheck-data[0].checkedAt).toBeGreaterThanOrEqual(300000);
  expect((await request.get(`${base}/api/source?key=thermal:LJU:extra`)).status()).toBe(404);
});
test('Napoved: five regional charts plus the Ljubljana sounding, region switch, no refresh button, no station fetches',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const keys:string[]=[],errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/source')keys.push(url.searchParams.get('key')||'');});
  await page.goto(`${base}/napoved/`);
  await expect(page.locator('#regional-images img, #sounding-image img')).toHaveCount(6,{timeout:45000});
  await expect(page.locator('#regional-meta')).toContainText('Napoved od ');
  // ALADIN viewer: the slider steps through frames (arrow keys when focused).
  await expect(page.locator('#forecast-image')).toBeVisible({timeout:45000});
  const position=await page.locator('#map-position').textContent();
  await expect(page.locator('#forecast-step')).toBeEnabled();
  await page.locator('#forecast-step').focus();await page.keyboard.press('ArrowRight');
  await expect(page.locator('#map-position')).not.toHaveText(position!);
  await expect(page.locator('#forecast-step')).toHaveValue(String(Number(position!.split('/')[0])));
  // One region picker on the page; it drives both the charts and the thermal forecast.
  await expect(page.locator('main select[aria-label="Regija"]')).toHaveCount(1);
  await expect(page.locator('#thermal-region-name')).toHaveText('Gorenjska');
  await page.selectOption('#chart-region','BOV');
  await expect(page.locator('#thermal-region-name')).toHaveText('Primorska');
  await expect(page.locator('#regional-images img, #sounding-image img')).toHaveCount(6,{timeout:45000});
  // No refresh button on Napoved; it refreshes on its own.
  await expect(page.locator('#refresh')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(keys).not.toContain('vetr');expect(keys).not.toContain('skytech');expect(keys).not.toContain('arso');expect(keys).not.toContain('luftar');expect(keys).not.toContain('stations');
  expect(errors).toEqual([]);
  // Text forecast and radar are shown without opening anything.
  await expect(page.locator('#aviation-text')).not.toHaveText('Nalaganje…',{timeout:30000});
  await expect(page.locator('#radar-image img')).toHaveCount(1,{timeout:30000});
  await page.getByRole('link',{name:'Zemljevid',exact:true}).click();await expect(page).toHaveURL(/\/$/);
});
test('Sv. Peter expands inline, shows one combined wind chart, and reuses cached history',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const historyRequests:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).searchParams.get('key')==='history:vetr:peter')historyRequests.push(request.url());});
  await page.goto(`${base}/postaje/`);
  await expect(page.locator('#stations')).toHaveAttribute('aria-busy','false',{timeout:45000});
  await page.fill('#search','peter');
  expect(historyRequests).toHaveLength(0);
  const trigger=page.locator('[data-expand="peter"]');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded','true');
  await expect(page.locator('#peter-detail [data-chart]')).toHaveCount(1,{timeout:30000});
  expect(historyRequests).toHaveLength(1);
  const latest=await page.locator('#peter-reading').textContent();
  await page.locator('#peter-time').focus();await page.locator('#peter-time').press('Home');
  await expect(page.locator('#peter-reading')).not.toHaveText(latest!);
  await expect(page.locator('#peter-reading')).toContainText('m/s');
  await expect(page.locator('#peter-detail [data-history-index]').first()).toBeVisible();
  const arrow=page.locator('[data-history-index]').last();
  await arrow.click();
  await expect(page.locator('#peter-reading')).toHaveText(latest!);
  await trigger.click();await expect(trigger).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('#peter-detail')).toBeHidden();
  await trigger.click();await expect(page.locator('#peter-detail [data-chart]')).toHaveCount(1);
  expect(historyRequests).toHaveLength(1);
  await expect(page.locator('#refresh')).toBeEnabled();await page.locator('#refresh').click();
  await expect(page.locator('#peter-detail [data-chart]')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('Sv. Peter history failure stays inline without invented readings',async({page})=>{
  await page.route(url=>url.searchParams.get('key')==='history:vetr:peter',route=>route.fulfill({status:503,body:'Unavailable'}));
  await page.goto(`${base}/postaje/`);
  await expect(page.locator('#stations')).toHaveAttribute('aria-busy','false',{timeout:45000});
  await page.fill('#search','peter');await page.locator('[data-expand="peter"]').click();
  await expect(page.locator('#peter-history-status')).toHaveText('Zgodovina ni na voljo.');
  await expect(page.locator('#peter-detail [data-chart]')).toHaveCount(0);
});
test('Zemljevid: live markers, site panel with wind graph only',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const errors:string[]=[],keys:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/source')keys.push(url.searchParams.get('key')||'');});
  await page.goto(base);
  await expect(page.locator('header')).toHaveText('Agregator veternih postaj');
  const peter=page.locator('.maplibregl-marker[title^="Sv. Peter"]');
  await expect(peter).toBeAttached({timeout:45000});
  // Skytech covers all of Slovenia; vetr, ARSO and Luftar only Gorenjska (and Kamnik).
  expect(await page.locator('.maplibregl-marker[title*=" · veter "]').count()).toBeGreaterThan(40);
  await expect(page.locator('.maplibregl-marker[title^="Donačka gora"]')).toHaveCount(1);
  await expect(page.locator('.maplibregl-marker[title^="Bilje"]')).toHaveCount(0); // ARSO outside Gorenjska stays off
  await expect(page.locator('.maplibregl-marker[title^="Velika planina"]')).toHaveCount(1); // Kamnik is included
  // Gozd and Vogar have both vetr and Skytech stations; only vetr is shown.
  await expect(page.locator('.maplibregl-marker[title^="Gozd"]')).toHaveCount(1);
  await expect(page.locator('.maplibregl-marker[title^="Vogar"]')).toHaveCount(1);
  await expect(page.locator('.maplibregl-marker[title^="Vogar - Bohinj"]')).toHaveCount(1);
  // Kriška gora: only the Luftar station; the offline Skytech one is left out.
  await expect(page.locator('.maplibregl-marker[title^="Kriška gora"]')).toHaveCount(1);
  await expect(page.locator('.maplibregl-marker[title^="Stol "]')).toHaveCount(2); // Karavanke (vetr) and Kobarid (Skytech)
  expect(keys.some(key=>key.startsWith('history:'))).toBe(false);
  await peter.dispatchEvent('click'); // Neighbouring markers overlap at the start zoom.
  await expect(page.locator('#site')).toBeVisible();
  await expect(page.locator('#site-name')).toHaveText('Sv. Peter');
  await expect(page.locator('#site-charts [data-chart]')).toHaveCount(1,{timeout:30000});
  await expect(page.locator('#site-forecast')).toHaveCount(0);
  const latest=await page.locator('#site-reading').textContent();
  // No slider: tapping the start of the graph (or Home on the focused graph) shows the oldest reading.
  await expect(page.locator('#site-time')).toHaveCount(0);
  await page.locator('#site-charts').focus();await page.locator('#site-charts').press('Home');
  await expect(page.locator('#site-reading')).not.toHaveText(latest!);
  await page.locator('#site-close').click();await expect(page.locator('#site')).toBeHidden();
  // Clicking empty map also closes the panel (clicking a station does not).
  await peter.dispatchEvent('click');await expect(page.locator('#site')).toBeVisible();
  await page.mouse.click(30,150);await expect(page.locator('#site')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(keys).toContain('history:vetr:peter');
  expect(errors).toEqual([]);
});
test('Zemljevid: search finds a site without diacritics and opens it',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(base);
  await expect(page.locator('.maplibregl-marker[title^="Kriška gora ·"]')).toBeAttached({timeout:45000});
  await page.locator('#site-search').fill('kriska');
  await expect(page.locator('#search-results [role="option"]').first()).toContainText('Kriška gora');
  await page.locator('#site-search').press('Enter');
  await expect(page.locator('#site-name')).toContainText('Kriška gora');
  await expect(page.locator('#search-results')).toBeHidden();
  // On phones the site panel covers the bottom search bar; close it to search again.
  await page.locator('#site-close').click();
  await page.locator('#site-search').fill('xyz nonexistent');
  await expect(page.locator('#search-results')).toContainText('Ni zadetkov.');
  await page.getByRole('link',{name:'Napoved',exact:true}).click();await expect(page).toHaveURL(/\/napoved\//);
});
test('Zemljevid: layers (wind on, webcams off by default); webcam images load only when opened',async({page})=>{
  // Phone view: it starts zoomed in on the home sites, where camera icons show (from zoom 9).
  await page.setViewportSize({width:390,height:844});
  const images:string[]=[];
  page.on('request',request=>{if(request.resourceType()==='image'&&/Dobrca/.test(request.url()))images.push(request.url());});
  await page.goto(base);
  const camera=page.locator('[aria-label="Spletna kamera: Koča na Dobrči"]');
  // Webcams are off by default; wind is on.
  await expect(page.locator('[data-layer="wind"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-layer="cameras"]')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('.maplibregl-marker[title^="Sv. Peter"]')).toBeVisible({timeout:45000});
  await expect(camera).toBeHidden();
  await page.locator('[data-layer="cameras"]').click();
  await expect(camera).toBeVisible();
  expect(images).toHaveLength(0);
  await camera.click();
  await expect(page.locator('.maplibregl-popup img')).toHaveCount(2);
  expect(images.length).toBeGreaterThan(0);
  // Turning wind off hides the station arrows; the choice survives a reload.
  await page.locator('[data-layer="wind"]').click();
  await expect(page.locator('.maplibregl-marker[title^="Sv. Peter"]')).toBeHidden();
  await page.reload();
  await expect(page.locator('[data-layer="wind"]')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('[aria-label="Spletna kamera: Koča na Dobrči"]')).toBeVisible({timeout:45000});
});
test('Skytech site opens with its own history',async({page})=>{
  await page.goto(base);
  const site=page.locator('.maplibregl-marker[title^="Potoška gora"]');
  await expect(site).toBeAttached({timeout:45000});
  await site.dispatchEvent('click');
  await expect(page.locator('#site-name')).toHaveText('Potoška gora');
  await expect(page.locator('#site-charts [data-chart]')).toHaveCount(1,{timeout:30000});
});
