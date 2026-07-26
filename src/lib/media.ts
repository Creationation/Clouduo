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

// Extrait les métadonnées AVANT upload (jamais le fichier n'est modifié).
export async function extractMeta(file: File): Promise<MediaMeta> {
  const mime = resolveMime(file)
  const kind = detectKind(mime)
  const meta: MediaMeta = { kind, mime, takenAt: new Date(file.lastModified).toISOString() }

  if (kind === 'photo') {
    try {
      const exif = await exifr.parse(file, {
        pick: ['DateTimeOriginal', 'CreateDate', 'ExifImageWidth', 'ExifImageHeight'],
      })
      const dt: Date | undefined = exif?.DateTimeOriginal ?? exif?.CreateDate
      if (dt instanceof Date && !isNaN(dt.getTime())) meta.takenAt = dt.toISOString()
    } catch {
      /* pas d'EXIF: on garde la date fichier */
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
