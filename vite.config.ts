import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: { proxy: { '/api': 'http://localhost:8787' } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // registered from main.tsx so updates reload the page
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Atlas',
        short_name: 'Atlas',
        description: 'Learn every country, capital, flag and map with spaced repetition.',
        // A manifest can't follow the system theme; the theme-color metas in index.html take over in dark mode.
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache the whole deck's media so the app works offline after first load.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Daily reminder notifications (public/push-sw.js).
        importScripts: ['push-sw.js'],
        // Pronunciation clips are fetched on demand and kept once heard.
        runtimeCaching: [
          {
            urlPattern: /\/voice\/.*\.mp3$/,
            handler: 'CacheFirst',
            options: { cacheName: 'voice-2', expiration: { maxEntries: 2000, maxAgeSeconds: 365 * 86400 } },
          },
        ],
      },
    }),
  ],
})
