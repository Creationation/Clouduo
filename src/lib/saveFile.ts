/**
 * Enregistrement d'un fichier sur l'appareil.
 *
 * Sur téléphone, le bouton de téléchargement passait par un lien HTML: la
 * photo atterrissait dans « Téléchargements » et n'apparaissait jamais dans la
 * Galerie. C'est le comportement normal d'un navigateur, pas d'une application
 * photo. Le plugin natif MediaSave range le média là où l'appareil photo le
 * range, dans un album « BubuCloud ».
 *
 * Le téléchargement classique reste la voie pour l'ordinateur, pour les
 * documents (qui n'ont rien à faire dans la Galerie) et pour un vieil Android
 * où l'écriture sans permission n'existe pas.
 */
import { registerPlugin } from '@capacitor/core'
import { signOne, downloadOriginal } from './urls'
import type { FileRow } from './types'

interface MediaSavePlugin {
  isSupported(): Promise<{ supported: boolean }>
  saveFromUrl(o: { url: string; name: string; mime: string }): Promise<{ uri: string }>
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean
}

let cached: MediaSavePlugin | null | undefined

/**
 * Comme pour ShareTarget, tout passe par registerPlugin et un try/catch: un
 * plugin absent ne doit jamais faire tomber l'interface (l'écran blanc du
 * 2026-07-27 venait exactement de là).
 */
function plugin(): MediaSavePlugin | null {
  if (cached !== undefined) return cached
  try {
    const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor
    if (!cap?.isNativePlatform?.()) {
      cached = null
      return null
    }
    cached = registerPlugin<MediaSavePlugin>('MediaSave')
  } catch {
    cached = null
  }
  return cached
}

/** Ce fichier a-t-il sa place dans la pellicule ? */
function isMedia(file: FileRow): boolean {
  return file.kind === 'photo' || file.kind === 'video'
}

/** Vrai si le bouton peut promettre « dans la galerie ». */
export function canSaveToGallery(file: FileRow): boolean {
  return isMedia(file) && plugin() !== null
}

export type SaveResult = 'gallery' | 'download'

/**
 * Enregistre le fichier. Renvoie où il a atterri, pour que l'écran dise la
 * vérité: promettre la galerie et livrer le dossier Téléchargements est
 * précisément ce qui posait problème.
 */
export async function saveFile(file: FileRow): Promise<SaveResult> {
  const p = plugin()
  if (p && isMedia(file)) {
    try {
      const url = await signOne(file.r2_key)
      await p.saveFromUrl({ url, name: file.name, mime: file.mime_type })
      return 'gallery'
    } catch {
      // Android trop ancien, galerie qui refuse, réseau coupé: on ne laisse
      // pas l'utilisateur sans rien, on retombe sur le téléchargement.
    }
  }
  await downloadOriginal(file.r2_key, file.name)
  return 'download'
}
