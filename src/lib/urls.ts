import { invokeFunction } from './supabase'

interface Cached {
  url: string
  expires: number
}
const cache = new Map<string, Cached>()
const TTL = 55 * 60 * 1000 // marge sous les 60 min de validité

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
  if (missing.length) {
    const { urls } = await invokeFunction<{ urls: Record<string, string> }>(
      'sign-download',
      { keys: missing },
    )
    for (const [k, url] of Object.entries(urls)) {
      cache.set(k, { url, expires: now + TTL })
      out[k] = url
    }
  }
  return out
}

// Signe une seule clé (visionneuse, streaming vidéo, téléchargement).
export async function signOne(
  key: string,
  opts?: { download?: boolean; filename?: string },
): Promise<string> {
  if (!opts?.download) {
    const c = cache.get(key)
    if (c && c.expires > Date.now()) return c.url
  }
  const { url } = await invokeFunction<{ url: string }>('sign-download', {
    key,
    ...opts,
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
