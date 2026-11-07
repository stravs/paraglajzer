// Makes the PNG icons and the social preview image (og.png) from public/favicon.svg with Chromium.
// Run after changing the logo: node scripts/icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/favicon.svg', 'utf8');
// iOS rounds the corners itself, so its icon is a full square.
const square = svg.replace('rx="270"', '');
// The white mark without the green square, for the preview image.
const mark = svg.replace(/<rect x="-60"[^>]*\/>/, '').replace('viewBox="-60 127 1206 1206"', 'viewBox="173 353 740 754"');
const og = `<div style="width:1200px;height:630px;box-sizing:border-box;padding:0 96px;display:flex;align-items:center;gap:56px;background:#1a3d2e;color:#fff;font-family:system-ui,sans-serif">
  <div style="width:220px;flex:none">${mark}</div>
  <div><div style="font-size:120px;font-weight:700;letter-spacing:-3px;line-height:1">Agregator</div>
  <div style="margin-top:20px;font-size:44px;opacity:.9">Vremenska mreža za outdoor</div>
  <div style="margin-top:28px;font-size:30px;opacity:.7">Veter v živo · kamere · sneg · reke</div></div></div>`;
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, width, height, html] of [
  ['apple-touch-icon.png', 180, 180, square], ['icon-192.png', 192, 192, svg], ['icon-512.png', 512, 512, svg], ['og.png', 1200, 630, og],
]) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<style>*{margin:0}svg{display:block;width:100%;height:100%}</style>${html}`);
  await page.screenshot({ path: `public/${name}`, omitBackground: name !== 'og.png' });
}
await browser.close();
