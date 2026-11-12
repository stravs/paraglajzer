import { test,expect } from '@playwright/test';
const base='http://172.17.0.2:4324';
test('shots',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(base);
  await expect(page.locator('.maplibregl-marker[title^="Sv. Peter"]')).toBeAttached({timeout:45000});
  await page.locator('#mode-toggle').click();
  await page.screenshot({path:'/tmp/claude-1000/-workspace-paraglajzer/6fe8b5e8-1d32-4eab-9c7d-e7eb4e8aef0d/scratchpad/d-wind.png'});
});
