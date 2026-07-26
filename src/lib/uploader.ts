import { supabase, invokeFunction } from './supabase'
import { type QueueItem } from './db'
import { fileHash } from './hash'
import { extractMeta } from './media'
import { makeThumbnail } from './thumbnail'

const MULTIPART_THRESHOLD = 100 * 1024 * 1024 // 100 Mo
const MIN_PART_SIZE = 16 * 1024 * 1024 // 16 Mo
const MAX_PARTS = 10_000 // plafond S3/R2
const PART_CONCURRENCY = 4 // parts envoyées en parallèle (saturer la ligne)
const SIGN_BATCH = 32 // parts signées par appel à l'Edge Function
const MAX_ATTEMPTS = 4 // par part: coupure réseau ou URL expirée
const PROGRESS_MS = 300 // throttle de la barre (chaque maj écrit en IndexedDB)

// R2 plafonne à 10 000 parts: sur un très gros fichier on agrandit la part
// au lieu d'échouer. 16 Mo couvre 160 Go, 32 Mo 320 Go, etc.
function pickPartSize(size: number): number {
  let part = MIN_PART_SIZE
  while (Math.ceil(size / part) > MAX_PARTS) part *= 2
  return part
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
    if (dup && dup.length > 0) {
      // Déjà chez moi: aucun ré-upload. Si c'était un envoi, on transfère la
      // ligne existante plutôt que de renvoyer les octets.
      if (item.sendToUserId) {
        await supabase.from('transfers').insert({
          file_id: dup[0].id,
          from_user: userId,
          to_user: item.sendToUserId,
          note: item.note ?? null,
        })
      }
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
  // La clé dépend de item.id: re-signer redonne la MÊME clé, donc réessayer
  // est sans effet de bord (pas d'objet orphelin).
  for (let attempt = 1; ; attempt++) {
    const sign = await invokeFunction<SignPut>('sign-upload', {
      action: 'put',
      name: item.name,
      mime: item.mime,
      uuid: item.id,
      withThumb: item.hasThumb,
    })
    await update({ status: 'uploading', r2_key: sign.r2_key, thumb_key: sign.thumb_key })
    if (attempt === 1) await uploadThumb(sign.thumbUploadUrl, item, signal)

    let last = 0
    try {
      await putWithProgress(
        sign.uploadUrl,
        item.file,
        item.mime,
        (loaded) => {
          const now = performance.now()
          if (now - last < PROGRESS_MS) return
          last = now
          void update({ progress: loaded / item.size }).catch(() => {})
        },
        signal,
      )
      return
    } catch (e) {
      if (signal.aborted || attempt >= MAX_ATTEMPTS) throw e
      await sleep(500 * attempt)
    }
  }
}

async function uploadMultipart(
  item: QueueItem,
  update: Update,
  signal: AbortSignal,
) {
  // Créer la session si nouvelle, sinon reprendre l'existante.
  if (!item.uploadId) {
    const chosen = pickPartSize(item.size)
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
    item.partSize = chosen
    item.parts = []
    await update({
      status: 'uploading',
      uploadId: sign.uploadId,
      r2_key: sign.r2_key,
      thumb_key: sign.thumb_key,
      partSize: chosen,
      parts: [],
    })
    await uploadThumb(sign.thumbUploadUrl, item, signal)
  } else {
    await update({ status: 'uploading' })
  }

  const partSize = item.partSize ?? MIN_PART_SIZE
  const totalParts = Math.ceil(item.size / partSize)
  // La dernière part est plus courte: la compter exactement, sinon la barre
  // de progression dépasse 100% sur les gros fichiers.
  const sizeOf = (n: number) =>
    n === totalParts ? item.size - (totalParts - 1) * partSize : partSize

  const done = new Map((item.parts ?? []).map((p) => [p.PartNumber, p]))
  const remaining: number[] = []
  for (let n = 1; n <= totalParts; n++) if (!done.has(n)) remaining.push(n)

  let completedBytes = 0
  for (const n of done.keys()) completedBytes += sizeOf(n)

  // Progression = parts terminées + avancement des parts en vol.
  const inflight = new Map<number, number>()
  let lastEmit = 0
  const emit = (force = false) => {
    const now = performance.now()
    if (!force && now - lastEmit < PROGRESS_MS) return
    lastEmit = now
    let sent = completedBytes
    for (const v of inflight.values()) sent += v
    void update({ progress: Math.min(1, sent / item.size) }).catch(() => {})
  }

  // Signature paresseuse par lots. Plusieurs workers tirent ici en même temps,
  // d'où la sérialisation: sans elle on signerait le même lot en double.
  const urls = new Map<number, string>()
  let cursor = 0
  let lock: Promise<unknown> = Promise.resolve()

  const signFrom = async (i: number) => {
    const batch = remaining.slice(i, i + SIGN_BATCH).filter((n) => !urls.has(n))
    if (!batch.length) return
    const res = await invokeFunction<{
      urls: { partNumber: number; url: string }[]
    }>('sign-upload', {
      action: 'multipart-sign',
      r2_key: item.r2_key,
      uploadId: item.uploadId,
      partNumbers: batch,
    })
    for (const u of res.urls) urls.set(u.partNumber, u.url)
  }

  const take = (): Promise<number | null> => {
    const run = lock.then(async () => {
      if (cursor >= remaining.length) return null
      const i = cursor++
      const n = remaining[i]
      if (!urls.has(n)) await signFrom(i)
      return n
    })
    lock = run.catch(() => {})
    return run
  }

  // Une URL présignée expire; sur un upload très long il faut la renouveler.
  const resign = async (n: number) => {
    const res = await invokeFunction<{
      urls: { partNumber: number; url: string }[]
    }>('sign-upload', {
      action: 'multipart-sign',
      r2_key: item.r2_key,
      uploadId: item.uploadId,
      partNumbers: [n],
    })
    const url = res.urls[0]?.url
    if (url) urls.set(n, url)
  }

  let fatal: unknown = null

  const worker = async () => {
    for (;;) {
      if (fatal) return
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      const n = await take()
      if (n === null) return

      const start = (n - 1) * partSize
      const blob = item.file.slice(start, start + sizeOf(n))

      for (let attempt = 1; ; attempt++) {
        inflight.set(n, 0)
        try {
          const etag = await putWithProgress(
            urls.get(n)!,
            blob,
            'application/octet-stream',
            (loaded) => {
              inflight.set(n, loaded)
              emit()
            },
            signal,
          )
          inflight.delete(n)
          completedBytes += sizeOf(n)
          done.set(n, { PartNumber: n, ETag: etag })
          item.parts = [...done.values()]
          // Persister après CHAQUE part => reprise fine après coupure réseau.
          await update({ parts: item.parts })
          emit(true)
          break
        } catch (e) {
          inflight.delete(n)
          if (signal.aborted || attempt >= MAX_ATTEMPTS) {
            fatal = e
            throw e
          }
          await sleep(500 * attempt)
          await resign(n).catch(() => {})
        }
      }
    }
  }

  const workers = Math.max(1, Math.min(PART_CONCURRENCY, remaining.length))
  await Promise.all(Array.from({ length: workers }, worker))

  await invokeFunction('sign-upload', {
    action: 'multipart-complete',
    r2_key: item.r2_key,
    uploadId: item.uploadId,
    parts: [...done.values()],
  })
}
