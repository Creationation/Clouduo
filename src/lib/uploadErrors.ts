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
 */
export type UploadErrorKey =
  | 'upload.errSpace'
  | 'upload.errMissing'
  | 'upload.errNet'
  | 'upload.errAuth'

export function uploadErrorKey(message: string): UploadErrorKey | null {
  const m = message.toLowerCase()
  if (
    m.includes('blob') ||
    m.includes('quota') ||
    m.includes('space') ||
    m.includes('disk') ||
    m.includes('storage')
  )
    return 'upload.errSpace'
  if (m.includes('introuvable') || m.includes('notfound') || m.includes('notreadable'))
    return 'upload.errMissing'
  if (
    m.includes('network') ||
    m.includes('réseau') ||
    m.includes('failed to fetch') ||
    m.includes('timeout') ||
    /http 5\d\d/.test(m)
  )
    return 'upload.errNet'
  if (m.includes('authentifi') || m.includes('jwt') || /http 40[13]/.test(m))
    return 'upload.errAuth'
  return null
}
