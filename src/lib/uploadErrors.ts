/**
 * Traduit un message d'échec d'envoi en une phrase compréhensible.
 *
 * Les messages bruts viennent du navigateur ou du serveur et sont en anglais
 * technique: "Failed to write blobs", "Failed to fetch", "HTTP 403". Affichés
 * tels quels, ils donnent l'impression que l'app part en morceaux alors que
 * la cause tient souvent en un mot (plus de place, plus de réseau).
 *
 * Renvoie une clé de traduction, ou null quand on ne sait pas: dans ce cas on
 * garde le message d'origine plutôt que d'inventer une explication.
 *
 * Piège déjà vécu: « blob », « storage » ou « disk » seuls étaient classés en
 * « mémoire pleine ». Un fichier illisible (photo restée dans le cloud Google
 * ou Samsung) affichait donc « plus d'espace » sur un téléphone à moitié vide.
 * Seules les formulations qui disent vraiment « plein » comptent ici.
 */
export type UploadErrorKey =
  | 'upload.errSpace'
  | 'upload.errUnreadable'
  | 'upload.errMissing'
  | 'upload.errNet'
  | 'upload.errAuth'

export function uploadErrorKey(message: string): UploadErrorKey | null {
  const m = message.toLowerCase()
  if (
    m.includes('quota') ||
    m.includes('failed to write blobs') ||
    m.includes('no space') ||
    m.includes('enough space') ||
    m.includes('enospc')
  )
    return 'upload.errSpace'
  // Le téléphone a donné une référence mais pas les octets: le cas typique
  // est une photo ancienne qui n'est plus que dans le cloud de la galerie.
  if (
    m.includes('notreadable') ||
    m.includes('could not be read') ||
    m.includes('fichier vide')
  )
    return 'upload.errUnreadable'
  if (m.includes('introuvable') || m.includes('notfound'))
    return 'upload.errMissing'
  if (
    m.includes('network') ||
    m.includes('réseau') ||
    m.includes('failed to fetch') ||
    m.includes('timeout') ||
    // Messages Java du telechargement natif (enregistrement sur le telephone).
    m.includes('timed out') ||
    m.includes('unable to resolve host') ||
    m.includes('connection') ||
    m.includes('unexpected end of stream') ||
    m.includes('socket') ||
    /http 5\d\d/.test(m)
  )
    return 'upload.errNet'
  if (m.includes('authentifi') || m.includes('jwt') || /http 40[13]/.test(m))
    return 'upload.errAuth'
  return null
}

/** Message d'erreur avec son type (NotReadableError, QuotaExceededError...):
 *  le message seul ne dit souvent rien de la cause. */
export function errorText(e: unknown): string {
  if (e instanceof Error) {
    return e.name && e.name !== 'Error' && !e.message.includes(e.name)
      ? `${e.name}: ${e.message}`
      : e.message
  }
  return String(e)
}
