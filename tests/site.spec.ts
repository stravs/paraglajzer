import { test,expect } from '@playwright/test';
// Search, link previews, headers and routes of the built site. Run against `astro preview` (the Workers runtime
// with the built files and _headers): the dev server has no sitemap and does not apply _headers.
const base=process.env.SITE_URL||'http://localhost:4325';
const origin='https://agregator.app';
test('robots.txt keeps crawlers off /api/ and names the sitemap',async({request})=>{
  const text=await (await request.get(`${base}/robots.txt`)).text();
  expect(text).toContain('Disallow: /api/');
  expect(text).not.toContain('/vetr');
  expect(text).toContain(`Sitemap: ${origin}/sitemap-index.xml`);
});
test('sitemap lists the public pages only',async({request})=>{
  expect(await (await request.get(`${base}/sitemap-index.xml`)).text()).toContain(`<loc>${origin}/sitemap-0.xml</loc>`);
  const urls=[...(await (await request.get(`${base}/sitemap-0.xml`)).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
  expect(urls).toEqual([`${origin}/`,`${origin}/napoved/`]);
});
for(const [path,title] of [['/','Agregator · veter v živo, kamere, sneg in reke'],['/napoved/','Napoved za jadralce · Agregator']]) {
  test(`${path}: title, description, canonical and link preview`,async({request})=>{
    const html=await (await request.get(`${base}${path}`)).text();
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toMatch(/<meta name="description" content="[^"]{50,}"/);
    expect(html).toContain(`<link rel="canonical" href="${origin}${path}">`);
    expect(html).toContain(`<meta property="og:image" content="${origin}/og.png">`);
    expect(html).not.toContain('noindex');
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  });
}
test('the map page describes the site for search engines',async({request})=>{
  const html=await (await request.get(`${base}/`)).text();
  const data=JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1]);
  expect(data).toMatchObject({'@type':'WebSite',name:'Agregator',url:`${origin}/`,inLanguage:'sl'});
});
test('static files: security headers; caching only for fingerprinted files and logos',async({request})=>{
  const page=await request.get(`${base}/`);
  expect(page.headers()['x-content-type-options']).toBe('nosniff');
  expect(page.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(page.headers()['cache-control']).not.toContain('immutable');
  const asset=(await page.text()).match(/\/_astro\/[^"]+\.css/)![0];
  expect((await request.get(`${base}${asset}`)).headers()['cache-control']).toContain('immutable');
  expect((await request.get(`${base}/logos/kok.png`)).headers()['cache-control']).toBe('public, max-age=86400');
  for(const file of ['/og.png','/llms.txt','/manifest.webmanifest','/apple-touch-icon.png'])expect((await request.get(`${base}${file}`)).status()).toBe(200);
});
test('pages without a trailing slash redirect to it',async({request})=>{
  const response=await request.get(`${base}/napoved`,{maxRedirects:0});
  expect([301,307,308]).toContain(response.status());
  expect(response.headers()['location']).toMatch(/\/napoved\/$/);
});
test('/vetr/: password prompt that search engines skip',async({request})=>{
  const response=await request.get(`${base}/vetr/`);
  expect(response.status()).toBe(401);
  expect(response.headers()['x-robots-tag']).toBe('noindex');
  expect(response.headers()['cache-control']).toBe('no-store');
});
test('/api/source: GET and HEAD only; unknown keys are 404',async({request})=>{
  const head=await request.head(`${base}/api/source?key=vetr`);
  expect(head.status()).toBe(200);
  expect(head.headers()['content-type']).toContain('application/json');
  expect(await head.body()).toHaveLength(0);
  const post=await request.post(`${base}/api/source?key=vetr`);
  expect(post.status()).toBe(405);
  expect(post.headers()['allow']).toBe('GET, HEAD');
  expect((await request.get(`${base}/api/source?key=nope`)).status()).toBe(404);
});
test('unknown pages: 404 with the site look, not indexed',async({request})=>{
  const response=await request.get(`${base}/ni-taka-stran/`);
  expect(response.status()).toBe(404);
  const html=await response.text();
  expect(html).toContain('<title>Stran ne obstaja · Agregator</title>');
  expect(html).toContain('<meta name="robots" content="noindex">');
});
