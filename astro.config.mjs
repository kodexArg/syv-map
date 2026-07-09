// @ts-check
import { defineConfig } from 'astro/config';

import svelte from '@astrojs/svelte';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  integrations: [svelte()],

  vite: {
    plugins: [tailwindcss()],
    // `better-sqlite3` is a native (Node ABI) addon; keep Vite from bundling it
    // so the dev server loads the real prebuilt binary at request time.
    ssr: { external: ['better-sqlite3'] }
  }
});