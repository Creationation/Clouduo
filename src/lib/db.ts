import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { FileKind, Scope } from './types'

export type QueueStatus =
  | 'pending'
  | 'processing'
  | 'uploading'
  | 'paused'
  | 'done'
  | 'dedup'
  | 'error'

// Un élément de la file d'attente d'upload. Le File est stocké tel quel
// dans IndexedDB (les Blob sont clonables) => reprise après fermeture de l'app.
export interface QueueItem {
  id: string
  file: File
  name: string
  size: number
  mime: string
  kind: FileKind
  scope: Scope
  folderId: string | null
  status: QueueStatus
  progress: number // 0..1
  error?: string
  // Métadonnées calculées
  hash?: string
  width?: number
  height?: number
  duration?: number
  takenAt?: string
  hasThumb?: boolean
  thumbBlob?: Blob // miniature générée, uploadée puis oubliée (non essentielle à la reprise)
  // État d'upload (pour reprise multipart)
  r2_key?: string
  thumb_key?: string | null
  uploadId?: string
  partSize?: number
  parts?: { PartNumber: number; ETag: string }[]
  // Envoi direct (upload + transfert en une action)
  sendToUserId?: string
  note?: string
  createdAt: number
}

interface HashCacheEntry {
  key: string // name|size|lastModified
  hash: string
}

interface Schema extends DBSchema {
  queue: { key: string; value: QueueItem }
  hashcache: { key: string; value: HashCacheEntry }
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null

export function db() {
  if (!dbp) {
    dbp = openDB<Schema>('nuageduo', 1, {
      upgrade(d) {
        d.createObjectStore('queue', { keyPath: 'id' })
        d.createObjectStore('hashcache', { keyPath: 'key' })
      },
    })
  }
  return dbp
}

export async function putItem(item: QueueItem) {
  ;(await db()).put('queue', item)
}
// Ajout en masse (dossier de plusieurs milliers de fichiers): une seule
// transaction au lieu d'une par fichier, sinon l'ajout prend des minutes.
export async function putItems(items: QueueItem[]) {
  const d = await db()
  const tx = d.transaction('queue', 'readwrite')
  for (const it of items) tx.store.put(it)
  await tx.done
}
export async function deleteItem(id: string) {
  ;(await db()).delete('queue', id)
}
export async function allItems(): Promise<QueueItem[]> {
  return (await db()).getAll('queue')
}
export async function getCachedHash(key: string): Promise<string | undefined> {
  return (await db()).get('hashcache', key).then((e) => e?.hash)
}
export async function setCachedHash(key: string, hash: string) {
  ;(await db()).put('hashcache', { key, hash })
}
