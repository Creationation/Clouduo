import exifr from 'exifr'
import type { FileKind } from './types'

export interface MediaMeta {
  kind: FileKind
  mime: string
  width?: number
  height?: number
  duration?: number
  takenAt?: string // ISO
}

export function detectKind(mime: string): FileKind {
  if (mime.startsWith('image/')) return 'photo'
  if (mime.startsWith('video/')) return 'video'
  return 'other'
}

// Windows ne donne pas de type MIME pour beaucoup de formats photo/vidéo
// (HEIC, MOV, MTS, RAW...). Sans ça ils seraient classés 'other' et ne
// passeraient pas le filtre de dépôt. On complète par l'extension.
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg',
  png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  tif: 'image/tiff', tiff: 'image/tiff', avif: 'image/avif',
  heic: 'image/heic', heif: 'image/heif', hif: 'image/heif',
  dng: 'image/x-adobe-dng', cr2: 'image/x-canon-cr2', cr3: 'image/x-canon-cr3',
  nef: 'image/x-nikon-nef', arw: 'image/x-sony-arw', raf: 'image/x-fuji-raf',
  orf: 'image/x-olympus-orf', rw2: 'image/x-panasonic-rw2',
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime',
  avi: 'video/x-msvideo', mkv: 'video/x-matroska', webm: 'video/webm',
  mts: 'video/mp2t', m2ts: 'video/mp2t', ts: 'video/mp2t',
  mpg: 'video/mpeg', mpeg: 'video/mpeg', '3gp': 'video/3gpp', wmv: 'video/x-ms-wmv',
  // Documents: kind reste 'other', ils vivent dans la section Documents.
  pdf: 'application/pdf', txt: 'text/plain', rtf: 'application/rtf',
  csv: 'text/csv', json: 'application/json', xml: 'application/xml',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac',
  epub: 'application/epub+zip',
}

export function mimeFromName(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return EXT_MIME[ext] ?? ''
}

// Type MIME retenu pour un fichier: celui du navigateur, sinon l'extension.
// Sert au classement et au Content-Type R2; n'altère jamais les octets.
export function resolveMime(file: File): string {
  return file.type || mimeFromName(file.name) || 'application/octet-stream'
}

// Une date de prise de vue plausible: ni avant l'appareil photo numérique,
// ni dans le futur. Sert à écarter les valeurs fantaisistes (fichier sans
// date, nom mal interprété, encodeur qui écrit n'importe quoi).
function plausible(d: Date | null | undefined): Date | null {
  if (!d || isNaN(d.getTime())) return null
  const t = d.getTime()
  if (t < Date.UTC(1995, 0, 1)) return null
  if (t > Date.now() + 36 * 3600 * 1000) return null
  return d
}

/**
 * Date lue dans le NOM du fichier.
 *
 * Indispensable, et pas un simple bonus: tout ce qui passe par WhatsApp,
 * Telegram, une capture d'écran ou un téléchargement arrive sans le moindre
 * EXIF. Sans ça on retombait sur la date de modification du fichier, c'est à
 * dire le moment où le téléphone l'a recopié: deux photos de la même soirée
 * pouvaient se retrouver classées à un jour d'écart. Le nom, lui, porte
 * l'heure réelle: "WhatsApp Image 2026-08-04 at 16.57.46", "IMG_20260804_165746",
 * "PXL_20260804_165746123", "Screenshot_20260804-165746", "signal-2026-08-04-165746".
 *
 * L'heure lue est une heure de pendule, sans fuseau: on la construit donc en
 * heure locale, exactement comme l'EXIF.
 */
export function dateFromName(name: string): Date | null {
  const base = name.replace(/\.[^.]+$/, '')

  // 1) aaaa mm jj, séparateurs libres.
  const m = base.match(/(199\d|20\d{2})[-_.:/]?(0[1-9]|1[0-2])[-_.:/]?(0[1-9]|[12]\d|3[01])/)
  if (m) {
    // Puis l'heure, juste derrière. Soit avec séparateurs ("at 16.57.46"),
    // soit six chiffres d'affilée ("_165746"). Pas quatre chiffres nus:
    // "IMG-20260804-WA0012" finit par un numéro d'ordre, pas par une heure,
    // et le lire comme 00h12 déplacerait la photo au petit matin.
    const rest = base.slice(m.index! + m[0].length)
    const t = rest.match(
      /^[^\d]{0,5}(?:([01]\d|2[0-3])[-_.:h ]([0-5]\d)(?:[-_.:m ]([0-5]\d))?|([01]\d|2[0-3])([0-5]\d)([0-5]\d))/,
    )
    const [h, mi, s] = t
      ? t[1] !== undefined
        ? [t[1], t[2], t[3]]
        : [t[4], t[5], t[6]]
      : [undefined, undefined, undefined]
    const dt = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      h ? Number(h) : 12, // sans heure: midi, pour ne pas basculer de jour
      mi ? Number(mi) : 0,
      s ? Number(s) : 0,
    )
    const ok = plausible(dt)
    if (ok) return ok
  }

  // 2) Horodatage en millisecondes (certains partages nomment ainsi).
  const epoch = base.match(/(?:^|[^\d])(1[5-9]\d{11}|2[0-1]\d{11})(?:[^\d]|$)/)
  if (epoch) {
    const ok = plausible(new Date(Number(epoch[1])))
    if (ok) return ok
  }
  return null
}

/**
 * Date de création inscrite dans le conteneur MP4/MOV (boîte `mvhd`).
 * Selon l'encodeur la boîte `moov` est en tête ou en queue de fichier: on
 * regarde les deux extrémités, jamais le fichier entier.
 */
async function videoCreationDate(file: File): Promise<Date | null> {
  const CHUNK = 512 * 1024
  const zones: [number, number][] = [
    [0, Math.min(CHUNK, file.size)],
    [Math.max(0, file.size - CHUNK), file.size],
  ]
  for (const [from, to] of zones) {
    if (to <= from) continue
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await file.slice(from, to).arrayBuffer())
    } catch {
      continue
    }
    for (let i = 0; i + 24 < bytes.length; i++) {
      if (
        bytes[i] !== 0x6d || // m
        bytes[i + 1] !== 0x76 || // v
        bytes[i + 2] !== 0x68 || // h
        bytes[i + 3] !== 0x64 // d
      )
        continue
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const p = i + 4
      const version = dv.getUint8(p)
      let secs: number
      try {
        secs = version === 1 ? Number(dv.getBigUint64(p + 4)) : dv.getUint32(p + 4)
      } catch {
        continue
      }
      // Époque QuickTime: 1er janvier 1904.
      const ok = plausible(new Date((secs - 2082844800) * 1000))
      if (ok) return ok
    }
  }
  return null
}

// Extrait les métadonnées AVANT upload (jamais le fichier n'est modifié).
export async function extractMeta(file: File): Promise<MediaMeta> {
  const mime = resolveMime(file)
  const kind = detectKind(mime)
  const meta: MediaMeta = { kind, mime }

  if (kind === 'photo') {
    try {
      const exif = await exifr.parse(file, {
        pick: [
          'DateTimeOriginal',
          'CreateDate',
          'DateTimeDigitized',
          'ModifyDate',
          'ExifImageWidth',
          'ExifImageHeight',
        ],
      })
      const dt =
        exif?.DateTimeOriginal ?? exif?.CreateDate ?? exif?.DateTimeDigitized ?? exif?.ModifyDate
      const ok = plausible(dt instanceof Date ? dt : null)
      if (ok) meta.takenAt = ok.toISOString()
    } catch {
      /* pas d'EXIF lisible: les secours ci-dessous prennent la main */
    }
    // Dimensions fiables via bitmap (marche pour JPEG/PNG/WebP/GIF).
    try {
      const bmp = await createImageBitmap(file)
      meta.width = bmp.width
      meta.height = bmp.height
      bmp.close()
    } catch {
      /* HEIC souvent non décodable par le navigateur: dimensions inconnues */
    }
  } else if (kind === 'video') {
    try {
      const info = await readVideoInfo(file)
      meta.width = info.width
      meta.height = info.height
      meta.duration = info.duration
    } catch {
      /* codec non lisible (HEVC): on garde ce qu'on a */
    }
  }

  // Secours, du plus fiable au moins fiable. La date de modification du
  // fichier arrive en dernier: sur téléphone c'est souvent l'instant de la
  // copie, pas celui de la prise de vue.
  if (!meta.takenAt) {
    const named = dateFromName(file.name)
    if (named) meta.takenAt = named.toISOString()
  }
  if (!meta.takenAt && kind === 'video') {
    const made = await videoCreationDate(file).catch(() => null)
    if (made) meta.takenAt = made.toISOString()
  }
  if (!meta.takenAt) {
    const stamp = plausible(new Date(file.lastModified))
    meta.takenAt = (stamp ?? new Date()).toISOString()
  }
  return meta
}

function readVideoInfo(
  file: File,
): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    const url = URL.createObjectURL(file)
    video.onloadedmetadata = () => {
      const out = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      }
      URL.revokeObjectURL(url)
      resolve(out)
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('video metadata error'))
    }
    video.src = url
  })
}
