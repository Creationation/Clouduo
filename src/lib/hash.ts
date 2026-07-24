import { createSHA256 } from 'hash-wasm'
import { getCachedHash, setCachedHash } from './db'

const CHUNK = 8 * 1024 * 1024 // 8 Mo

// sha-256 en streaming (par tranches) pour ne pas charger un fichier de
// plusieurs Go en mémoire. Résultat mis en cache par (nom|taille|lastModified)
// pour que le backup ré-exécuté ignore instantanément les déjà-hachés.
export async function fileHash(
  file: File,
  onProgress?: (p: number) => void,
): Promise<string> {
  const cacheKey = `${file.name}|${file.size}|${file.lastModified}`
  const cached = await getCachedHash(cacheKey)
  if (cached) {
    onProgress?.(1)
    return cached
  }

  const hasher = await createSHA256()
  hasher.init()
  let offset = 0
  while (offset < file.size) {
    const slice = file.slice(offset, offset + CHUNK)
    const buf = new Uint8Array(await slice.arrayBuffer())
    hasher.update(buf)
    offset += CHUNK
    onProgress?.(Math.min(1, offset / file.size))
  }
  const hex = hasher.digest('hex')
  await setCachedHash(cacheKey, hex)
  return hex
}
