import { defineConfig } from 'vite';

// base: './' keeps every asset path relative, so the built site works from any
// folder, GitHub Pages sub-path, or a shared static host.
export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: false },
  // The STEP/IGES reader is only loaded on demand (dynamic import). Bundle it
  // at startup so a first import never triggers a mid-session re-bundle, which
  // leaves an open page requesting an outdated copy ("Failed to fetch
  // dynamically imported module").
  optimizeDeps: { include: ['occt-import-js'] },
  build: { chunkSizeWarningLimit: 2000 },
});
