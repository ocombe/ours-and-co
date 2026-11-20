import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Served from https://ocombe.github.io/ours-and-co/
export default defineConfig({
  base: '/ours-and-co/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Ours & Co',
        short_name: 'Ours & Co',
        description: 'Les repas, les courses et la réserve de la famille.',
        lang: 'fr',
        start_url: '/ours-and-co/',
        scope: '/ours-and-co/',
        display: 'standalone',
        background_color: '#FCC532',
        theme_color: '#4A2F22',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      includeAssets: ['icons/favicon-head-32.png', 'icons/favicon-head-48.png', 'icons/apple-touch-icon.png', 'icons/bear-head-128.png'],
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
})
