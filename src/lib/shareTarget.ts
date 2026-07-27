/**
 * Réception des fichiers partagés depuis Android.
 *
 * Le plugin natif (ShareTargetPlugin.java) copie les fichiers partagés dans le
 * cache de l'app et les expose morceau par morceau. On les réassemble ici en
 * objets File, que la file d'envoi existante traite comme n'importe quelle
 * sélection: aucun chemin d'upload parallèle à maintenir.
 */

import { registerPlugin } from '@capacitor/core'

export interface SharedFileMeta {
  id: string
  name: string
  mime: string
  size: number
}

// 1 Mo par appel: assez gros pour ne pas multiplier les allers-retours,
// assez petit pour ne pas saturer le pont natif (le base64 pèse +33%).
const CHUNK = 1024 * 1024

interface ShareTargetPlugin {
  getPending(): Promise<{ files: SharedFileMeta[] }>
  readChunk(o: {
    id: string
    offset: number
    length: number
  }): Promise<{ data: string; eof: boolean }>
  release(o: { id: string }): Promise<void>
  addListener(
    event: 'shareReceived',
    cb: (data: { files: SharedFileMeta[] }) => void,
  ): Promise<{ remove: () => Promise<void> }>
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean
}

let cached: ShareTargetPlugin | null | undefined

/**
 * Il FAUT passer par registerPlugin: `Capacitor.Plugins.X` est l'ancienne
 * voie et ne fournit pas toujours addListener. Appeler une méthode absente
 * lève une exception dans un useEffect, React démonte alors tout l'arbre et
 * l'écran devient entièrement blanc — c'est exactement ce qui est arrivé sur
 * le téléphone le 2026-07-27. D'où aussi le try/catch: aucun problème de
 * plugin ne doit pouvoir emporter l'interface.
 */
function plugin(): ShareTargetPlugin | null {
  if (cached !== undefined) return cached
  try {
    const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor
    if (!cap?.isNativePlatform?.()) {
      cached = null
      return null
    }
    cached = registerPlugin<ShareTargetPlugin>('ShareTarget')
  } catch {
    cached = null
  }
  return cached
}

export const isNativeShareAvailable = () => plugin() !== null

function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const buf = new ArrayBuffer(bin.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i)
  return buf
}

/**
 * Rapatrie un fichier partagé. Les morceaux sont empilés en Blob plutôt
 * qu'en un seul tableau d'octets: Chromium stocke les gros Blob sur disque,
 * ce qui évite de charger une vidéo entière en mémoire.
 */
export async function fetchSharedFile(
  meta: SharedFileMeta,
  onProgress?: (loaded: number) => void,
): Promise<File | null> {
  const p = plugin()
  if (!p) return null
  const parts: Blob[] = []
  let offset = 0
  for (;;) {
    const { data, eof } = await p.readChunk({
      id: meta.id,
      offset,
      length: CHUNK,
    })
    if (data) {
      const bytes = base64ToBytes(data)
      parts.push(new Blob([bytes]))
      offset += bytes.byteLength
      onProgress?.(offset)
    }
    if (eof || !data) break
  }
  await p.release({ id: meta.id }).catch(() => {})
  return new File(parts, meta.name, { type: meta.mime })
}

/** Fichiers déjà en attente au démarrage (partage ayant réveillé l'app). */
export async function pendingShared(): Promise<SharedFileMeta[]> {
  const p = plugin()
  if (!p || typeof p.getPending !== 'function') return []
  try {
    const res = await p.getPending()
    return res?.files ?? []
  } catch {
    return []
  }
}

/** Partage reçu alors que l'app était déjà ouverte. */
export function onShared(
  cb: (files: SharedFileMeta[]) => void,
): () => void {
  const p = plugin()
  if (!p || typeof p.addListener !== 'function') return () => {}
  let remove: (() => Promise<void>) | null = null
  try {
    p.addListener('shareReceived', (d) => cb(d?.files ?? []))
      .then((h) => {
        remove = h?.remove ?? null
      })
      .catch(() => {})
  } catch {
    return () => {}
  }
  return () => {
    try {
      remove?.()
    } catch {
      /* le plugin peut avoir disparu au démontage */
    }
  }
}
