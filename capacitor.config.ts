import type { CapacitorConfig } from '@capacitor/cli'

/**
 * APK natif pointant sur l'app déployée (même principe que l'app bureau):
 * un déploiement Vercel met à jour le téléphone sans reconstruire l'APK.
 *
 * Comme la WebView charge directement l'URL distante, l'origine de la page
 * est celle du domaine de production. La CORS R2 déjà en place pour ce
 * domaine s'applique donc telle quelle, rien à ajouter côté Cloudflare.
 */
const config: CapacitorConfig = {
  appId: 'com.creationation.clouduo',
  appName: 'Clouduo',
  webDir: 'dist',
  server: {
    url: 'https://clouduo-puce.vercel.app',
    cleartext: false,
    androidScheme: 'https',
    // La navigation reste sur le domaine de l'app; le reste part dans le
    // navigateur du téléphone.
    allowNavigation: ['clouduo-puce.vercel.app'],
  },
  android: {
    // L'app gère elle-même ses zones sûres (safe-area) en CSS.
    adjustMarginsForEdgeToEdge: 'disable',
  },
}

export default config
