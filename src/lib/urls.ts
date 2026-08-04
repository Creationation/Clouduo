import { invokeFunction } from './supabase'

interface Cached {
  url: string
  expires: number
}
const cache = new Map<string, Cached>()
const TTL = 55 * 60 * 1000 // marge sous les 60 min de validité

/**
 * Les clés partent dans l'adresse de la requête côté fonction (PostgREST
 * reçoit un filtre `in.(...)` construit avec, deux fois). Une galerie un peu
 * fournie suffisait à dépasser la longueur admise, et la requête échouait
 * avant même d'atteindre la base: plus une seule miniature à l'écran, sans le
 * moindre message. On signe donc par paquets.
 */
const BATCH = 25

async function signChunk(keys: string[]): Promise<Record<string, string>> {
  const { urls } = await invokeFunction<{ urls: Record<string, string> }>(
    'sign-download',
    { keys },
  )
  return urls ?? {}
}

// Signe un lot de clés (miniatures). Utilise le cache pour éviter de re-signer.
export async function signBatch(keys: string[]): Promise<Record<string, string>> {
  const now = Date.now()
  const out: Record<string, string> = {}
  const missing: string[] = []
  for (const k of keys) {
    const c = cache.get(k)
    if (c && c.expires > now) out[k] = c.url
    else missing.push(k)
  }

  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH)
    let urls: Record<string, string> = {}
    try {
      urls = await signChunk(chunk)
    } catch {
      // Un paquet qui tombe ne doit pas emporter toute la galerie: on
      // réessaie les clés une par une, et celles qui passent s'affichent.
      const single = await Promise.all(
        chunk.map((k) =>
          signOne(k).then(
            (u) => [k, u] as const,
            () => null,
          ),
        ),
      )
      for (const pair of single) if (pair) urls[pair[0]] = pair[1]
    }
    for (const [k, url] of Object.entries(urls)) {
      cache.set(k, { url, expires: now + TTL })
      out[k] = url
    }
  }
  return out
}

// Signe une seule clé (visionneuse, streaming vidéo, téléchargement).
// `fresh` force une nouvelle signature: sert quand une URL en cache a été
// refusée, typiquement parce qu'elle a expiré pendant que l'app dormait.
export async function signOne(
  key: string,
  opts?: { download?: boolean; filename?: string; fresh?: boolean },
): Promise<string> {
  if (!opts?.download && !opts?.fresh) {
    const c = cache.get(key)
    if (c && c.expires > Date.now()) return c.url
  }
  const { url } = await invokeFunction<{ url: string }>('sign-download', {
    key,
    download: opts?.download,
    filename: opts?.filename,
  })
  if (!opts?.download) cache.set(key, { url, expires: Date.now() + TTL })
  return url
}

// Déclenche le téléchargement de l'original exact (octet pour octet).
export async function downloadOriginal(key: string, filename: string) {
  const url = await signOne(key, { download: true, filename })
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
