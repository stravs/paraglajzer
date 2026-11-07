import { test,expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const base=process.env.TEST_URL||'http://172.17.0.2:4324';
test('concurrent source requests reuse the same global check',async({request})=>{
  const responses=await Promise.all(Array.from({length:8},()=>request.get(`${base}/api/source?key=vetr`)));
  const data=await Promise.all(responses.map(response=>response.json()));
  expect(data[0].data.length).toBeGreaterThan(0);
  expect(new Set(data.map(snapshot=>snapshot.checkedAt)).size).toBe(1);
  // vetr's next check follows the home stations' sends: at least 20 s, at most 10 min ahead.
  expect(data[0].nextCheck-data[0].checkedAt).toBeGreaterThanOrEqual(20000);
  expect(data[0].nextCheck-data[0].checkedAt).toBeLessThanOrEqual(600000);
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
  await expect(page.locator('#radar-image img')).toHaveCount(2,{timeout:30000});
  await page.getByRole('link',{name:'Zemljevid',exact:true}).click();await expect(page).toHaveURL(/\/$/);
});
test('Zemljevid: live markers, site panel with wind graph only',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const errors:string[]=[],keys:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/source')keys.push(url.searchParams.get('key')||'');});
  await page.goto(base);
  await expect(page.locator('header')).toContainText('Agregator');
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
  // Phones: the header's search button opens the search box.
  await expect(page.locator('#site-search')).toBeHidden();
  await page.locator('#search-toggle').click();
  await page.locator('#site-search').fill('kriska');
  await expect(page.locator('#search-results [role="option"]').first()).toContainText('Kriška gora');
  await page.locator('#site-search').press('Enter');
  await expect(page.locator('#site-name')).toContainText('Kriška gora');
  await expect(page.locator('#site-search')).toBeHidden();
  await page.locator('#site-close').click();
  await page.locator('#search-toggle').click();
  await page.locator('#site-search').fill('xyz nonexistent');
  await expect(page.locator('#search-results')).toContainText('Ni zadetkov.');
  await page.getByRole('link',{name:'Napoved',exact:true}).click();await expect(page).toHaveURL(/\/napoved\//);
});
test('Zemljevid: wind layer is the default; with webcams on, wind markers hide and a camera on a station can be tapped; images load only when opened',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const errors:string[]=[],requests:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>requests.push(request.url()));
  // Start zoomed in on Krvavec, where the ARSO camera and wind station share a spot.
  const cam=JSON.parse(readFileSync('public/webcams.json','utf8')).find((cam:{name:string})=>cam.name==='Krvavec');
  await page.addInitScript(([lat,lon])=>{if(!localStorage.getItem('mapView'))localStorage.setItem('mapView',JSON.stringify({center:[lon,lat],zoom:12}));},cam.location);
  await page.goto(base);
  await expect(page.locator('.maplibregl-marker[title^="Krvavec"]')).toBeVisible({timeout:45000});
  const button=page.getByRole('button',{name:'Kamere',exact:true});
  await expect(button).toHaveAttribute('aria-pressed','false');
  await page.waitForTimeout(1000);
  expect(requests.filter(url=>url.endsWith('/webcams.json'))).toHaveLength(0);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.maplibregl-marker[title^="Krvavec"]')).toBeHidden();
  expect(requests.filter(url=>url.includes('KRVAVEC_dir'))).toHaveLength(0);
  // A real click: it fails if the station's arrow or label covers the camera.
  await page.getByRole('button',{name:'Spletna kamera: Krvavec'}).click();
  // Phones: it opens in the bottom sheet, not a bubble.
  const card=page.locator('#site');
  await expect(card.locator('#site-name')).toHaveText('Krvavec');
  await expect(page.locator('.maplibregl-popup')).toHaveCount(0);
  await expect(card.locator('#site-card img')).toHaveCount(cam.images.length);
  await expect(card.locator('#site-wind')).toBeHidden();
  expect(requests.some(url=>url.includes('KRVAVEC_dir'))).toBe(true);
  await page.locator('#site-close').click();
  await expect(card).toBeHidden();
  // Back to wind: stations take taps again; then cameras on again for the reload check.
  await page.getByRole('button',{name:'Veter',exact:true}).click();
  await expect(page.getByRole('button',{name:'Veter',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(button).toHaveAttribute('aria-pressed','false');
  await expect(page.getByRole('button',{name:'Spletna kamera: Krvavec'})).toHaveCount(0);
  await expect(page.locator('.maplibregl-marker[title^="Krvavec"]')).toBeVisible();
  await button.click();
  // The choice survives a reload.
  await page.reload();
  await expect(page.getByRole('button',{name:'Kamere',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(errors).toEqual([]);
});
test('Zemljevid: snow layer shows non-zero ARSO stations as bar charts; on desktop a tap opens a bubble, for wind stations too',async({page})=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  // Fixed readings: live ones are often all 0.
  const at='2026-11-06T06:00:00.000Z',now=Date.now();
  const data=[
    {name:'Kredarica',location:[46.3794,13.8539],depth:{value:120,at},newSnow:{value:15,hours:24,at},rain:{value:8,hours:24,at}},
    {name:'Ljubljana',location:[46.0658,14.5172],depth:{value:0,at},newSnow:{value:0,hours:12,at},rain:{value:0,hours:12,at}},
    {name:'Vogel',location:[46.2639,13.8456],depth:null,newSnow:null,rain:{value:3,hours:12,at}},
  ];
  await page.route('**/api/source?key=snow',route=>route.fulfill({json:{data,fetchedAt:now,checkedAt:now,nextCheck:now+1800000,error:null}}));
  await page.goto(base);
  await expect(page.locator('.maplibregl-marker[title^="Krvavec"]')).toBeAttached({timeout:45000});
  const button=page.getByRole('button',{name:'Sneg',exact:true});
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed','true');
  const kredarica=page.getByRole('button',{name:/^Kredarica · snežna odeja 120 cm/});
  await expect(kredarica).toBeVisible();
  await expect(page.locator('.maplibregl-marker[title^="Krvavec"]')).toBeHidden();
  await expect(kredarica.locator('[style*="height"]')).toHaveCount(3);
  await expect(page.getByRole('button',{name:/^Vogel · /}).locator('[style*="height"]')).toHaveCount(1);
  await expect(page.getByRole('button',{name:/^Ljubljana · /})).toHaveCount(0);
  // Desktop: it opens in a bubble above the marker.
  await kredarica.click();
  const bubble=page.locator('.maplibregl-popup');
  await expect(bubble.locator('#site-name')).toHaveText('Kredarica');
  await expect(bubble.locator('#site-card tr')).toHaveCount(3);
  await expect(bubble).toContainText('15 cm/24 h');
  await page.keyboard.press('Escape');
  await expect(bubble).toHaveCount(0);
  await expect(page.locator('#site')).toBeHidden();
  await page.getByRole('button',{name:'Veter',exact:true}).click();
  await expect(kredarica).toHaveCount(0);
  // A wind station opens in the bubble too.
  await page.locator('.maplibregl-marker[title^="Krvavec"]').first().dispatchEvent('click');
  await expect(bubble.locator('#site-name')).toContainText('Krvavec');
  await expect(bubble.locator('#site-wind')).toBeVisible();
  await page.locator('#site-close').click();
  await expect(bubble).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('Zemljevid: rivers layer shows ARSO flows with a rating dot; tapping one opens its readings',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  const now=Date.now();
  const data=[
    {id:'3060',river:'Sava',place:'Litija',location:[46.0566,14.8226],observedAt:new Date(now).toISOString(),flow:612,rating:'velik pretok',level:250,temperature:8.1,floodFlows:[600,900,1200]},
    {id:'3200',river:'Sora',place:'Suha',location:[46.15,14.32],observedAt:new Date(now).toISOString(),flow:0.35,rating:'mali pretok',level:40,temperature:null,floodFlows:[]},
  ];
  await page.route('**/api/source?key=rivers',route=>route.fulfill({json:{data,fetchedAt:now,checkedAt:now,nextCheck:now+1800000,error:null}}));
  await page.addInitScript(()=>localStorage.setItem('mapView',JSON.stringify({center:[14.6,46.08],zoom:8.5})));
  await page.goto(base);
  await expect(page.locator('.maplibregl-marker[title^="Krvavec"]')).toBeAttached({timeout:45000});
  await page.getByRole('button',{name:'Reke',exact:true}).click();
  const litija=page.getByRole('button',{name:/^Sava · Litija · pretok 612 m³\/s/});
  await expect(litija).toBeVisible();
  await expect(litija.locator('.bg-red-600')).toHaveCount(1);
  await expect(page.getByRole('button',{name:/^Sora · Suha · pretok 0.35 m³\/s/}).locator('.bg-amber-400')).toHaveCount(1);
  await litija.click();
  await expect(page.locator('#site-name')).toHaveText('Sava · Litija');
  await expect(page.locator('#site-card tr')).toHaveCount(4);
  await expect(page.locator('#site-card')).toContainText('600 / 900 / 1200 m³/s');
  await page.locator('#site-close').click();
  await expect(page.locator('#site')).toBeHidden();
  expect(errors).toEqual([]);
});
test('Skytech site opens with its own history',async({page})=>{
  await page.goto(base);
  const site=page.locator('.maplibregl-marker[title^="Potoška gora"]');
  await expect(site).toBeAttached({timeout:45000});
  await site.dispatchEvent('click');
  await expect(page.locator('#site-name')).toHaveText('Potoška gora');
  await expect(page.locator('#site-charts [data-chart]')).toHaveCount(1,{timeout:30000});
});
test('Vetr.si page: password, then vetr.si values next to our own, per station',async({browser,request})=>{
  expect((await request.get(`${base}/vetr/`)).status()).toBe(401);
  // The password is a secret: from the environment or the local .dev.vars, never written here.
  let password:string|undefined=process.env.VETR_PASSWORD;
  try{password??=readFileSync('.dev.vars','utf8').match(/^VETR_PASSWORD=(.*)$/m)?.[1]?.trim();}catch{/* No local secrets. */}
  test.skip(!password,'VETR_PASSWORD not set');
  const page=await browser.newPage({httpCredentials:{username:'pilot',password:password!}});
  await page.setViewportSize({width:390,height:844});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/vetr/`);
  await expect(page.locator('#vetr-compare article').first()).toBeVisible({timeout:45000});
  await expect(page.locator('#vetr-compare article').first()).toContainText('Sv. Peter');
  await expect(page.locator('#vetr-compare article').first().locator('tbody tr')).toHaveCount(3);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/vetr.png',fullPage:true});
  expect(errors).toEqual([]);
});
test('Zemljevid: a link with the site name opens it; the address follows the open site',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.goto(`${base}/#sv-peter`);
  await expect(page.locator('#site-name')).toHaveText('Sv. Peter',{timeout:45000});
  await expect(page).toHaveURL(`${base}/#sv-peter`);
  // Desktop: the share button copies the link (browsers allow it on HTTPS or localhost only).
  if(await page.evaluate(()=>isSecureContext)) {
    await page.locator('#site-share').click();
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(`${base}/#sv-peter`);
  }
  // Names without diacritics: Potoška gora is #potoska-gora.
  await page.goto(`${base}/#potoska-gora`);
  await expect(page.locator('#site-name')).toHaveText('Potoška gora',{timeout:45000});
  await page.locator('#site-close').click();
  await expect(page).toHaveURL(`${base}/`);
});
