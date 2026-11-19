import { paraglideVitePlugin } from '@inlang/paraglide-js';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // French only: the base locale, without cookie or URL detection.
    paraglideVitePlugin({ project: './project.inlang', outdir: './src/i18n/paraglide', strategy: ['baseLocale'] }),
    VitePWA({
      registerType: 'autoUpdate',
      // The shell only: API answers are never cached.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'La Pince',
        short_name: 'La Pince',
        lang: 'fr',
        start_url: '/',
        display: 'standalone',
        background_color: '#fbf7f2',
        theme_color: '#c2410c',
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
