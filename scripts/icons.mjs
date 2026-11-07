import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/favicon.svg', 'utf8');
// iOS rounds the corners itself, so its icon is a full square.
const square = svg.replace('rx="270"', '');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, source] of [['apple-touch-icon.png', 180, square], ['icon-192.png', 192, svg], ['icon-512.png', 512, svg]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${source}`);
  await page.screenshot({ path: `public/${name}`, omitBackground: true });
}
await browser.close();
