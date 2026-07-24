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

// Extrait les métadonnées AVANT upload (jamais le fichier n'est modifié).
export async function extractMeta(file: File): Promise<MediaMeta> {
  const mime = file.type || 'application/octet-stream'
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
