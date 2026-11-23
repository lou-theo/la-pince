import { paraglideVitePlugin } from '@inlang/paraglide-js';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// French only: the base locale, without cookie or URL detection.
const paraglide = () => paraglideVitePlugin({ project: './project.inlang', outdir: './src/i18n/paraglide', strategy: ['baseLocale'] });

export default defineConfig({
  plugins: [
    react(),
    paraglide(),
    VitePWA({
      registerType: 'autoUpdate',
      // Written by hand, for its push and notificationclick handlers; it precaches the shell like a generated one (`src/sw/sw.ts`).
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      // The service worker is built apart, with its own instance of each plugin it needs.
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png}'], buildPlugins: { vite: [paraglide()] } },
      manifest: {
        name: 'La Pince',
        short_name: 'La Pince',
        lang: 'fr',
        start_url: '/',
        display: 'standalone',
        background_color: '#fbf7f2',
        theme_color: '#2f6b4f',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
    }),
  ],
  server: {
    // `wrangler dev` of apps/server.
    proxy: { '/api': 'http://localhost:8787' },
  },
});
