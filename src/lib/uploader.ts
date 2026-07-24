import { supabase, invokeFunction } from './supabase'
import { type QueueItem } from './db'
import { fileHash } from './hash'
import { extractMeta } from './media'
import { makeThumbnail } from './thumbnail'

const MULTIPART_THRESHOLD = 100 * 1024 * 1024 // 100 Mo
const PART_SIZE = 16 * 1024 * 1024 // 16 Mo
const SIGN_BATCH = 6 // parts signées par lot

type Update = (patch: Partial<QueueItem>) => Promise<void>

// PUT avec progression et abort (fetch ne donne pas la progression d'upload).
function putWithProgress(
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // ETag nécessaire pour finaliser un multipart (exposé via CORS R2).
        resolve((xhr.getResponseHeader('ETag') ?? '').replace(/"/g, ''))
      } else {
        reject(new Error(`HTTP ${xhr.status} ${xhr.statusText}`))
      }
    }
    xhr.onerror = () => reject(new Error('erreur réseau'))
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'))
    signal.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}

interface SignPut {
  r2_key: string
  thumb_key: string | null
  uploadUrl: string
  thumbUploadUrl: string | null
}
interface SignMultipart {
  r2_key: string
  thumb_key: string | null
  uploadId: string
  thumbUploadUrl: string | null
}

/**
 * Traite un élément de la file: prépare (hash/meta/thumb), déduplique,
 * upload (simple ou multipart avec reprise), insère la ligne files,
 * et déclenche un transfert si demandé. Idempotent sur reprise.
 */
export async function processItem(
  item: QueueItem,
  update: Update,
  signal: AbortSignal,
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth.user?.id
  if (!userId) throw new Error('non authentifié')

  // 1) Préparation (une seule fois; ignorée si on reprend un upload en cours).
  if (!item.hash) {
    await update({ status: 'processing', progress: 0 })
    const meta = await extractMeta(item.file)
    const hash = await fileHash(item.file)
    const thumbBlob = await makeThumbnail(item.file, meta.kind)
    item.thumbBlob = thumbBlob ?? undefined
    await update({
      hash,
      kind: meta.kind,
      mime: meta.mime,
      width: meta.width,
      height: meta.height,
      duration: meta.duration,
      takenAt: meta.takenAt,
      hasThumb: !!thumbBlob,
    })

    // 2) Dédup: si ce hash existe déjà chez moi (actif), on n'upload pas.
    const { data: dup } = await supabase
      .from('files')
      .select('id')
      .eq('owner_id', userId)
      .eq('content_hash', hash)
      .is('deleted_at', null)
      .limit(1)
    if (dup && dup.length > 0 && !item.sendToUserId) {
      await update({ status: 'dedup', progress: 1 })
      return
    }
  }

  const useMultipart = item.size > MULTIPART_THRESHOLD

  if (!useMultipart) {
    await uploadSimple(item, update, signal)
  } else {
    await uploadMultipart(item, update, signal)
  }

  // 3) Insertion de la ligne files (référence l'objet original).
  const { data: inserted, error } = await supabase
    .from('files')
    .insert({
      owner_id: userId,
      folder_id: item.folderId,
      scope: item.scope,
      name: item.name,
      mime_type: item.mime,
      kind: item.kind,
      size_bytes: item.size,
      r2_key: item.r2_key!,
      thumb_key: item.thumb_key ?? null,
      width: item.width ?? null,
      height: item.height ?? null,
      duration_seconds: item.duration ?? null,
      content_hash: item.hash!,
      taken_at: item.takenAt ?? null,
    })
    .select('id')
    .single()
  if (error) throw error

  // 4) Envoi direct (upload + transfert en une action).
  if (item.sendToUserId && inserted) {
    await supabase.from('transfers').insert({
      file_id: inserted.id,
      from_user: userId,
      to_user: item.sendToUserId,
      note: item.note ?? null,
    })
  }

  await update({ status: 'done', progress: 1 })
}

async function uploadThumb(
  thumbUploadUrl: string | null,
  item: QueueItem,
  signal: AbortSignal,
) {
  if (thumbUploadUrl && item.thumbBlob) {
    await putWithProgress(
      thumbUploadUrl,
      item.thumbBlob,
      'image/webp',
      () => {},
      signal,
    ).catch(() => {
      /* miniature best-effort: si elle échoue, on affichera un placeholder */
    })
  }
}

async function uploadSimple(item: QueueItem, update: Update, signal: AbortSignal) {
  const sign = await invokeFunction<SignPut>('sign-upload', {
    action: 'put',
    name: item.name,
    mime: item.mime,
    uuid: item.id,
    withThumb: item.hasThumb,
  })
  await update({ status: 'uploading', r2_key: sign.r2_key, thumb_key: sign.thumb_key })
  await uploadThumb(sign.thumbUploadUrl, item, signal)
  await putWithProgress(
    sign.uploadUrl,
    item.file,
    item.mime,
    (loaded) => update({ progress: loaded / item.size }),
    signal,
  )
}

async function uploadMultipart(
  item: QueueItem,
  update: Update,
  signal: AbortSignal,
) {
  // Créer la session si nouvelle, sinon reprendre l'existante.
  if (!item.uploadId) {
    const sign = await invokeFunction<SignMultipart>('sign-upload', {
      action: 'multipart-create',
      name: item.name,
      mime: item.mime,
      uuid: item.id,
      withThumb: item.hasThumb,
    })
    item.uploadId = sign.uploadId
    item.r2_key = sign.r2_key
    item.thumb_key = sign.thumb_key
    item.partSize = PART_SIZE
    item.parts = []
    await update({
      status: 'uploading',
      uploadId: sign.uploadId,
      r2_key: sign.r2_key,
      thumb_key: sign.thumb_key,
      partSize: PART_SIZE,
      parts: [],
    })
    await uploadThumb(sign.thumbUploadUrl, item, signal)
  } else {
    await update({ status: 'uploading' })
  }

  const partSize = item.partSize ?? PART_SIZE
  const totalParts = Math.ceil(item.size / partSize)
  const done = new Map((item.parts ?? []).map((p) => [p.PartNumber, p]))
  const doneBytes = () => done.size * partSize // approximation pour la barre

  // Numéros de parts restant à uploader.
  const remaining: number[] = []
  for (let n = 1; n <= totalParts; n++) if (!done.has(n)) remaining.push(n)

  for (let i = 0; i < remaining.length; i += SIGN_BATCH) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    const batch = remaining.slice(i, i + SIGN_BATCH)
    const { urls } = await invokeFunction<{
      urls: { partNumber: number; url: string }[]
    }>('sign-upload', {
      action: 'multipart-sign',
      r2_key: item.r2_key,
      uploadId: item.uploadId,
      partNumbers: batch,
    })

    for (const { partNumber, url } of urls) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      const start = (partNumber - 1) * partSize
      const blob = item.file.slice(start, Math.min(start + partSize, item.size))
      const etag = await putWithProgress(
        url,
        blob,
        'application/octet-stream',
        (loaded) =>
          update({ progress: Math.min(1, (doneBytes() + loaded) / item.size) }),
        signal,
      )
      done.set(partNumber, { PartNumber: partNumber, ETag: etag })
      item.parts = [...done.values()]
      // Persister après CHAQUE part => reprise fine après coupure réseau.
      await update({ parts: item.parts, progress: done.size / totalParts })
    }
  }

  await invokeFunction('sign-upload', {
    action: 'multipart-complete',
    r2_key: item.r2_key,
    uploadId: item.uploadId,
    parts: [...done.values()],
  })
}
