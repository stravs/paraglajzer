// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  devToolbar: { enabled: false },
  session: false,
  output: 'server',
  vite: {
    plugins: [tailwindcss()],
    // FAKE_DATA=1 npm run dev: made-up wind history on the map, see src/lib/trail.ts. Off in builds.
    define: { __FAKE_DATA__: JSON.stringify(process.env.FAKE_DATA === '1' && process.argv.includes('dev')) }
  },

  adapter: cloudflare()
});