import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'BubuCloud',
        short_name: 'BubuCloud',
        description: 'Notre cloud privé',
        lang: 'fr',
        theme_color: '#dbe4ff',
        background_color: '#eef2ff',
        display: 'standalone',
        // 'any' et non 'portrait': une galerie photo se regarde aussi en
        // paysage, et l'app tourne également sur tablette et bureau.
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Le nouveau service worker prend la main tout de suite au lieu
        // d'attendre la fermeture de tous les onglets.
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,

        // Ne jamais mettre en cache les objets R2 (originaux/vidéos
        // volumineuses) ni les réponses signées: on ne garde que le shell.
        //
        // Le HTML est volontairement EXCLU du précache. Les fichiers js/css
        // portent une empreinte dans leur nom, donc un déploiement crée de
        // nouveaux noms et ne peut pas être servi périmé. index.html, lui,
        // garde la même adresse: précaché, il continuait à référencer
        // l'ancien bundle après un déploiement. C'est ce qui a fait tourner
        // l'app bureau sur une version dont la clé API avait été révoquée,
        // rendant toute connexion impossible sans message utile.
        globPatterns: ['**/*.{js,css,woff2}'],
        navigateFallback: undefined,
        navigateFallbackDenylist: [/^\/functions\//],
        runtimeCaching: [
          {
            // Navigation: le réseau d'abord, le cache seulement en secours.
            // Un déploiement est donc pris en compte au chargement suivant.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 4 },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/icons/'),
            handler: 'CacheFirst',
            options: { cacheName: 'icons', expiration: { maxEntries: 20 } },
          },
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
})
