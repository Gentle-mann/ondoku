import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false, // we have our own public/manifest.json
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,wasm}'],
        maximumFileSizeToCacheInBytes: 80 * 1024 * 1024, // 80MB for the dict
        runtimeCaching: [
          {
            urlPattern: /\/dict\//,
            handler: 'CacheFirst',
            options: { cacheName: 'dict-cache', expiration: { maxEntries: 5 } },
          },
        ],
      },
    }),
  ],
})
