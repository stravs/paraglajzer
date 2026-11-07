# Agregator

Vremenska mreža za outdoor: paragliding weather for Slovenia. Live at https://agregator.app/ (`site` in `astro.config.mjs`).

- `/`: map of wind stations (vetr.si, Skytech, ARSO, Luftar). Tap a site for its wind graph. The layer bar (right edge on phones, bottom on desktop) switches the layer: wind, webcams (all ARSO cameras), snow (ARSO's snow depth and new snow) or rivers (ARSO's river flows).
- `/napoved/`: ARSO and Zaladin forecasts, sounding, thermals, radar.

Astro + Tailwind + Cloudflare Workers. The Worker (`src/worker.ts`) fetches and caches all sources, so every user shares one copy and providers get few requests.

## Run

```sh
npm install
npm run dev -- --host
npm run dev:fake -- --host   # made-up wind history for the map's time slider
```

The map's time slider uses the last 3 h of readings, which the Worker records from each station listing (a cron checks the listings every 10 min). In dev the cron doesn't run, so `dev:fake` makes up a history from the current readings.

The webcam list is `public/webcams.json`. Refresh it now and then with `node scripts/webcams.mjs`.

The logo is `src/components/Logo.astro`, the app icon `public/favicon.svg`. After changing the icon, remake the PNG icons and the link preview image (`public/og.png`) with `node scripts/icons.mjs`.

For search engines and agents: `robots.txt` (`src/pages/robots.txt.ts`), the sitemap (`@astrojs/sitemap`, without `/vetr/`), `public/llms.txt`, and security and cache headers for static files in `public/_headers`.

## Test

```sh
npm test                 # parser tests
npm run check            # types
TEST_URL=http://172.17.0.2:4324 npx playwright test tests/dashboard.spec.ts  # app tests against a running server
npm run build && npx astro preview --port 4325       # the built site in the Workers runtime
SITE_URL=http://localhost:4325 npx playwright test tests/site.spec.ts  # SEO files, headers, redirects, routes
```

## Deploy

```sh
npx wrangler login
npm run deploy
```

`/vetr/` (vetr.si values vs. our own) asks for a password. Set it once with `npx wrangler secret put VETR_PASSWORD`; locally it goes in `.dev.vars` (`VETR_PASSWORD=...`).

## Key files

- `src/lib/sources.ts`: sources and parsers
- `src/worker.ts`: cache and API
- `src/scripts/map.ts`: map
- `src/scripts/forecast.ts`: Napoved

Not an official briefing. Check the original sources before flying.
