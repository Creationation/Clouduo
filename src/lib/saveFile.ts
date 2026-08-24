/**
 * Enregistrement d'un fichier sur l'appareil.
 *
 * Dans l'application, TOUT passe par le natif: rien ne sort vers le
 * navigateur. Un lien de téléchargement HTML ne peut pas faire autrement que
 * déléguer au navigateur, qui ouvre l'adresse de stockage et dépose le
 * fichier dans « Téléchargements »: on quittait l'app, on voyait passer une
 * adresse technique, et une photo n'arrivait jamais dans la Galerie.
 *
 * Le plugin MediaSave écrit lui-même: photo et vidéo dans la pellicule (album
 * BubuCloud), document dans Téléchargements. Le téléchargement classique ne
 * subsiste que là où il est la seule voie possible: sur ordinateur.
 */
import { registerPlugin } from '@capacitor/core'
import { signOne, downloadOriginal } from './urls'
import type { FileRow } from './types'

interface MediaSavePlugin {
  isSupported(): Promise<{ supported: boolean }>
  saveFromUrl(o: {
    url: string
    name: string
    mime: string
  }): Promise<{ uri: string; gallery: boolean }>
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

/** Vrai dans l'application (par opposition au site ouvert sur ordinateur). */
export function isApp(): boolean {
  return plugin() !== null
}

/** Où le fichier a réellement atterri. */
export type SaveResult = 'gallery' | 'downloads' | 'browser'

/**
 * Enregistre le fichier et dit où il est allé, pour que l'écran ne promette
 * pas la galerie en livrant autre chose.
 *
 * Dans l'app, un échec est signalé comme tel: on ne bascule pas en douce vers
 * le navigateur, qui est précisément ce qu'on cherche à éviter.
 */
export async function saveFile(file: FileRow): Promise<SaveResult> {
  const p = plugin()
  if (p) {
    const url = await signOne(file.r2_key)
    const res = await p.saveFromUrl({
      url,
      name: file.name,
      mime: file.mime_type,
    })
    return res.gallery ? 'gallery' : 'downloads'
  }
  // Ordinateur: le téléchargement du navigateur est la seule voie.
  await downloadOriginal(file.r2_key, file.name)
  return 'browser'
}
