// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import cloudflare from '@astrojs/cloudflare';

import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // Production origin: canonical links, social tags, sitemap and robots.txt are built from it.
  site: 'https://agregator.app',
  // Pages build to folders (/napoved/index.html) and Cloudflare redirects /napoved to /napoved/, so links,
  // canonicals and the sitemap all end in a slash. trailingSlash stays at its default: 'always' makes the dev
  // server answer /api/source with 404 before the Worker sees it.
  devToolbar: { enabled: false },
  session: false,
  output: 'server',
  // CSS goes into the page itself: no stylesheet requests hold up the first render.
  build: { inlineStylesheets: 'always' },

  vite: {
    plugins: [tailwindcss()],
    // FAKE_DATA=1 npm run dev: made-up wind history on the map, see src/lib/trail.ts. Off in builds.
    define: { __FAKE_DATA__: JSON.stringify(process.env.FAKE_DATA === '1' && process.argv.includes('dev')) }
  },

  adapter: cloudflare(),
  // /vetr/ is password-protected and not for search engines.
  integrations: [sitemap({ filter: page => !page.includes('/vetr/'), namespaces: { news: false, xhtml: false, image: false, video: false } })]
});