import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/. The workflow passes the repo
// name through BASE_PATH; local dev and preview use the default below.
const base = process.env.BASE_PATH ?? '/BlastEffect/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
    sourcemap: false,
  },
});
