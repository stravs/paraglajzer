# Paraglajzer

Paragliding weather for Slovenia.

- `/`: map of wind stations (vetr.si, Skytech, ARSO, Luftar). Tap a site for its wind graph.
- `/napoved/`: ARSO and Zaladin forecasts, sounding, thermals, radar.

Astro + Tailwind + Cloudflare Workers. The Worker (`src/worker.ts`) fetches and caches all sources, so every user shares one copy and providers get few requests.

## Run

```sh
npm install
npm run dev -- --host
npm run dev:fake -- --host   # made-up wind history for the map's time slider
```

The map's time slider uses the last 3 h of readings, which the Worker records from each station listing (a cron checks the listings every 10 min). In dev the cron doesn't run, so `dev:fake` makes up a history from the current readings.

## Test

```sh
npm test                 # parser tests
npm run check            # types
TEST_URL=http://172.17.0.2:4324 npx playwright test  # browser tests against a running server
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
