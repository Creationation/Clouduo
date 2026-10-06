import type { FileKind } from './types'

const MAX = 400 // côté max de la miniature
const QUALITY = 0.8

// Génère une miniature WebP ~400px. FICHIER SÉPARÉ, l'original n'est jamais touché.
// Retourne null si le navigateur ne sait pas décoder la source (HEIC/HEVC):
// on retombe alors sur un placeholder + téléchargement de l'original.
//
// Jamais plus de THUMB_TIMEOUT: certaines vidéos (HEVC, 4K, fichiers longs)
// ne déclenchent ni `seeked` ni `error` dans la WebView. La promesse restait
// pendante pour toujours, et comme la file traite un fichier à la fois, TOUS
// les envois et enregistrements suivants restaient bloqués derrière. Une
// miniature ratée n'empêche rien: le fichier part avec un aperçu générique.
const THUMB_TIMEOUT = 20_000

export function makeThumbnail(file: File, kind: FileKind): Promise<Blob | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), THUMB_TIMEOUT)
    buildThumbnail(file, kind).then(
      (b) => {
        clearTimeout(timer)
        resolve(b)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
    )
  })
}

async function buildThumbnail(file: File, kind: FileKind): Promise<Blob | null> {
  try {
    if (kind === 'photo') {
      const bmp = await createImageBitmap(file)
      const blob = drawToWebp(bmp, bmp.width, bmp.height)
      bmp.close()
      return blob
    }
    if (kind === 'video') {
      return await videoFrame(file)
    }
  } catch {
    return null
  }
  return null
}

function drawToWebp(
  source: CanvasImageSource,
  w: number,
  h: number,
): Blob | null {
  const scale = Math.min(1, MAX / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * scale))
  const ch = Math.max(1, Math.round(h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, cw, ch)
  // toBlob est async; ici on utilise la version data-URL synchrone pour rester simple.
  const url = canvas.toDataURL('image/webp', QUALITY)
  // Certains navigateurs ne savent pas encoder en webp -> retombe en jpeg.
  const finalUrl = url.startsWith('data:image/webp')
    ? url
    : canvas.toDataURL('image/jpeg', QUALITY)
  return dataUrlToBlob(finalUrl)
}

function videoFrame(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    const url = URL.createObjectURL(file)
    const cleanup = () => {
      video.onloadedmetadata = video.onseeked = video.onerror = null
      URL.revokeObjectURL(url)
      // Libère le décodeur tout de suite au lieu d'attendre le ramasse-miettes:
      // deux cents vidéos d'affilée épuisaient les décodeurs du téléphone.
      video.removeAttribute('src')
      video.load()
    }
    // Filet de sécurité: si rien ne répond, on rend la main (et le décodeur).
    const guard = setTimeout(() => {
      cleanup()
      resolve(null)
    }, THUMB_TIMEOUT - 1000)
    const done = (b: Blob | null) => {
      clearTimeout(guard)
      resolve(b)
    }

    video.onloadedmetadata = () => {
      // On vise ~1s (ou le milieu pour les clips très courts).
      video.currentTime = Math.min(1, (video.duration || 2) / 2)
    }
    video.onseeked = () => {
      let blob: Blob | null = null
      try {
        blob = drawToWebp(video, video.videoWidth, video.videoHeight)
      } catch {
        /* image illisible: aperçu générique */
      }
      cleanup()
      done(blob)
    }
    video.onerror = () => {
      cleanup()
      done(null)
    }
    video.src = url
  })
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',')
  const mime = head.match(/data:(.*?);/)?.[1] ?? 'image/webp'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}
