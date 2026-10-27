# Paraglajzer

Slovenian paragliding weather tool. `/` is a map of stations with live wind; tapping a site opens its wind graph. `/napoved/` has forecasts and images, `/postaje/` a compact station table in m/s. Astro + Tailwind v4 + Cloudflare Workers. No React, accounts, or database service. The only client-to-provider requests are map tiles and, when a webcam popup is opened, that camera's images.

## Run

Node 22.23.4+ (Node 24 recommended).

```sh
npm install
npm run generate-types
npm run dev -- --host
```

Use the network URL printed by Astro. In this container the current URL is http://172.17.0.2:4324/ (ports may vary).

```sh
npm test                 # deterministic parser tests, no network
npm run check            # TypeScript + Astro
npm run build
npm run preview -- --host
TEST_URL=http://172.17.0.2:4324 npx playwright test  # live integration tests
```

Install Chromium for browser tests with `npx playwright install chromium`.

## Deploy

```sh
npx wrangler login
npm run deploy
```

The SQLite-backed `SourceCache` Durable Object is declared and migrated by `wrangler.jsonc`; no KV namespace or external database setup is needed. The HTML is prerendered. The custom Worker handles `/api/source`, with a single globally named Durable Object (`shared-v1`) enforcing all upstream limits. No Cloudflare account is connected or deployment performed by this project setup.

## Sources and refresh policy

| Source/product | Interval between successful checks | Trigger |
| --- | --- | --- |
| vetr.si station listing | 10 minutes | Visible map or Postaje page |
| Station wind history (vetr page / Skytech `c=graf`) | 10 minutes | Opened map site or expanded Sv. Peter row |
| Skytech station table (POST `c=tabela`) | 10 minutes | Visible map or Postaje page |
| ARSO automatic stations (`observationAms_si_latest.xml`, wind stations only) | 10 minutes | Visible map or Postaje page |
| Luftar stations (Kriška gora, Sebenje/Križe; `luftar.si/data/wsData*HiCharts.json`) | 10 minutes | Visible map or Postaje page |
| Luftar station wind history (same files) | 10 minutes | Opened Luftar site |
| ARSO station wind history (`recent/observationAms_<id>history.xml`, last 6 h kept) | 10 minutes | Opened ARSO site |
| ARSO thermal RSS, per region | 10 minutes | Selected region |
| ARSO aviation text | 10 minutes | Open briefing |
| Zaladin ALADIN frame list, per layer | 30 minutes | Selected layer |
| ARSO sounding | 30 minutes | Open sounding |
| ARSO Jadralci model-run discovery | 30 minutes | Regional charts visible |
| ARSO dated regional charts | 24 hours | Selected region only |
| ARSO radar | 5 minutes | Load radar |
| ARSO dated model image | 24 hours | Selected frame only |

Checks fall on clock boundaries of their interval (10-minute sources at :00, :10, :20 …) and are never sooner than half an interval after the last one. The four station listings are served together (`/api/source?key=stations`), and every response may be cached by the browser until the server's next check, so an open map makes about one request per 10 minutes (plus one per 10 minutes for an open site's history).

These are **conservative starting policies**, not verified provider update SLAs or permissions. vetr's observed station configuration currently reports 10–20 minute sending intervals; ARSO thermal RSS advertises a 10-minute TTL. Contact the operators to confirm acceptable reuse and request rates before a public launch. We do not run their JavaScript, embed their pages, or download an entire animation.

Browser checks run once per minute while visible (a request is only made once the server's next check is due), and pause when hidden. Refresh never forces a source check. All users share the same persisted source snapshot. Concurrent requests for a source share one in-flight promise. Conditional requests use ETag/Last-Modified when supplied. A station missing from a new listing (ARSO sometimes publishes a partial file mid-update) keeps its previous reading while it is under 2 h old. Failures keep the last good data and retry after exponential backoff (capped at 6 hours). Nothing is polled while unused. A 12-second upstream timeout prevents hanging requests.

All upstream URLs are allowlisted, with canonical cache keys. Model images must appear in a cached Zaladin frame list. Only normalized weather fields leave the Worker; vetr device/SIM configuration is never exposed. Raw upstream HTML is not executed or injected into the page. One narrow `miniflare.undici` override fixes a transitive development-tool vulnerability; npm audit is clean at setup time.

## Features

- **Gorenjska (plus Kamnik) only, for now.** Every station source is filtered in the Worker to the Gorenjska statistical region (OpenStreetMap relation 1699230) plus Kamnik municipality (relation 1675668, for Velika planina and Kamniški vrh), in `src/lib/gorenjska.ts`; other stations never reach the browser, and their history is not served. Forecasts on Napoved still cover all of Slovenia.

- ARSO automatic stations that report wind (about 54, including Kanin, Kredarica, Krvavec, Vogel, Nanos, Slavnik) are on the map, list and search. Their exact degrees are rounded to 8 compass points; their region is the nearest Jadralci forecast region. ARSO XML is read with regexes and history stops after 6 h, to keep Worker CPU low on 0.8–2.5 MB files.
- Flat, north-up map (MapLibre GL + OpenTopoMap tiles, colour washed out to light grey when zoomed out; no tilt or rotation) with live average wind, gusts and direction per station as slim arrows (pointing where the wind blows, black, red when the average or gusts are over 10 m/s) with an "average / gust" label underneath; stale stations are almost transparent. Where vetr and Skytech have a station with the same site name (and within 5 km), only vetr is shown. vetr gives coordinates; Skytech positions are a local table in `src/lib/sites.ts`: OpenStreetMap paragliding launches/landings where they exist, otherwise the named peak or airfield (2 Skytech stations are not on the map; the offline Skytech Kriška gora is left out everywhere, replaced by Luftar's station). Skytech graphs only give HH:MM, so they are dated from the table's observation time.
- Luftar (Tržič paragliding club) runs its own stations at Kriška gora and Sebenje/Križe; their Gozd, Potoška gora and Ambrož readings are the Skytech stations already shown. Luftar timestamps are Ljubljana wall-clock time; positions are approximate.
- Combined vetr/Skytech/ARSO/Luftar station list, source/region/search filters, freshness and exact observation times.
- Wind and gusts in m/s only; saved stations use local storage.
- Sv. Peter expands inline into a wind-strength SVG graph (average/gust) and a scrollable row of timestamped wind-direction arrows, with a shared time slider. Arrows point where the wind blows; compass labels show where it comes from. Tap an arrow to inspect that reading. History is normalized from vetr.si's embedded weather data and fetched only when expanded. Missing speed readings and large time gaps are not connected.
- Six ARSO thermal regions and forecast validity dates.
- Ten Zaladin layers, newest model run, manual time slider, single-frame downloads.
- All five Jadralci regional images for all 12 regions: temperature gradient, relative humidity/clouds, wind, and two forecast soundings.
- Model-run discovery follows ARSO's 04/16 UTC switch, with bounded fallback checks for missing runs; dates are never hardcoded. Only selected-region images are fetched, starting when the section becomes visible.
- ARSO aviation text, Ljubljana sounding, and rain radar on demand.
- Two map layers, toggled with buttons above the zoom control: wind stations (on by default) and webcams (off by default). The choice is remembered per browser; picking a station in search turns wind back on.
- Small camera icons (from zoom 9) for public webcams around the home sites, listed in `src/lib/webcams.ts`: Klagenfurter Hütte, Bodental, Zelenica (hut + ARSO), Ljubelj, Dobrča, Kriška gora, Sebenje, Tržič and A2 Vrba. Tapping one opens a popup with its current images, loaded from the operator only then. Station arrows draw above camera icons. Ask the operators before a public launch.
- The map page has no header: a floating site search (ignores diacritics, shows current wind; Enter opens the site) with a Napoved link (Postaje is reached from the other pages' top bar). Other pages keep the top bar. Plain tables and images, inline expandable ARSO details.
- Each page fetches only its own data: no station requests on Napoved or forecast requests on Postaje.
- Explicit stale data and partial-source errors; no safe-to-fly score.

The full ARSO Jadralci page remains linked for additional altitude-wind maps, tabular height forecasts, and official warnings. All five regional image products are included; the entire aviation application is not mirrored. ARSO thermal dates and sounding/radar image timestamps must be checked by the pilot. Skytech wall-clock timestamps are interpreted in `Europe/Ljubljana`; the autumn DST repeated hour is inherently ambiguous because the source provides no UTC offset.

## Key files

- `src/lib/sources.ts`: upstream definitions and parsers.
- `src/lib/jadralci.ts`: 12 regions, regional image paths, and dated model-run discovery.
- `src/worker.ts`: globally shared, persistent cache and API.
- `src/scripts/weather.ts`: shared browser cache and visibility-aware polling.
- `src/scripts/stations.ts` and `src/scripts/forecast.ts`: page-specific clients.
- `src/lib/history.ts` and `src/scripts/wind-charts.ts`: Sv. Peter history normalization and dependency-free SVG graphs.
- `src/pages/napoved.astro` and `src/pages/postaje.astro`: prerendered pages.
- `src/pages/index.astro` and `src/scripts/map.ts`: map and site panel.
- `src/lib/sites.ts`: station coordinates missing from the sources.
- `src/layouts/Layout.astro`: shared minimal navigation.
- `tests/`: parser tests and live mobile/cache integration tests.

## Before public use

Confirm provider reuse rights, update cadence, and attribution requirements. Consider endpoint abuse protection (Cloudflare rate limiting/Turnstile as appropriate), and monitoring. A daily Durable Object alarm (scheduled only while the app is used) deletes dated map images not checked for 2 days. The app is an aid, not an official briefing, and must not be used as the sole basis for a flying decision.
