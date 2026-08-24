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

// Un élément de la file d'attente d'upload.
//
// Les octets du fichier ne sont PAS dans cette ligne: ils vivent à part, dans
// le magasin `blobs`, écrits une seule fois. Auparavant le File était rangé
// dans la ligne elle-même, et comme la ligne est réécrite à chaque avancement
// de la barre de progression (toutes les 300 ms) puis après chaque part d'un
// envoi multipart, le navigateur recopiait le fichier entier sur le disque à
// chaque fois. Dix photos suffisaient à écrire plusieurs giga-octets: le
// quota du site sautait, Chromium répondait "Failed to write blobs", l'envoi
// s'arrêtait et l'app restait coincée jusqu'à vidage manuel de la liste.
export interface QueueItem {
  id: string
  /** Les octets. Absents d'un envoi terminé (libérés) ou d'une reprise dont
   *  le stockage a été purgé. */
  file?: File
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
  thumbBlob?: Blob // miniature générée, uploadée puis oubliée (jamais persistée)
  // État d'upload (pour reprise multipart)
  r2_key?: string
  thumb_key?: string | null
  uploadId?: string
  partSize?: number
  parts?: { PartNumber: number; ETag: string }[]
  // Envoi direct (upload + transfert en une action)
  sendToUserId?: string
  note?: string
  /** Marque l'envoi: tous les fichiers d'une même sélection le partagent, ce
   *  qui permet à la boîte de réception de les présenter comme un seul envoi
   *  au lieu d'une carte par fichier. */
  batchId?: string
  createdAt: number
}

/** Ce qui est réellement écrit dans `queue`: tout sauf les octets. */
type StoredItem = Omit<QueueItem, 'file' | 'thumbBlob'>

interface StoredBlob {
  id: string
  file: File
}

interface HashCacheEntry {
  key: string // name|size|lastModified
  hash: string
}

export type ExportStatus = 'pending' | 'running' | 'done' | 'error'

/**
 * Un enregistrement demandé (une photo qui part du cloud vers le téléphone).
 *
 * Persisté comme la file d'envoi, et pour la même raison: quitter l'écran,
 * changer d'onglet ou fermer l'app ne doit pas faire disparaître un travail
 * en cours. Aucun octet ici, seulement de quoi le refaire.
 */
export interface ExportItem {
  id: string
  fileId: string
  name: string
  r2_key: string
  mime: string
  status: ExportStatus
  /** Où le fichier a atterri, une fois fini. */
  where?: 'gallery' | 'downloads' | 'browser'
  error?: string
  createdAt: number
}

interface Schema extends DBSchema {
  queue: { key: string; value: StoredItem }
  blobs: { key: string; value: StoredBlob }
  hashcache: { key: string; value: HashCacheEntry }
  exports: { key: string; value: ExportItem }
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null

export function db() {
  if (!dbp) {
    dbp = openDB<Schema>('nuageduo', 3, {
      upgrade(d, oldVersion) {
        // v3 seule: on ajoute la file des enregistrements, sans toucher au
        // reste. Repasser par le nettoyage de la v2 viderait une file d'envoi
        // en cours pour rien.
        if (oldVersion >= 2) {
          if (!d.objectStoreNames.contains('exports'))
            d.createObjectStore('exports', { keyPath: 'id' })
          return
        }
        // On repart d'une file vide. C'est aussi ce qui rend l'espace occupé
        // par les copies accumulées en v1: les envois déjà terminés y
        // gardaient leurs octets tant que personne ne vidait la liste à la
        // main. Un envoi en cours au moment de la mise à jour est à
        // resélectionner, une fois.
        if (d.objectStoreNames.contains('queue')) d.deleteObjectStore('queue')
        if (d.objectStoreNames.contains('blobs')) d.deleteObjectStore('blobs')
        d.createObjectStore('queue', { keyPath: 'id' })
        d.createObjectStore('blobs', { keyPath: 'id' })
        // Le cache d'empreintes est minuscule et évite de re-hasher: on le garde.
        if (!d.objectStoreNames.contains('hashcache'))
          d.createObjectStore('hashcache', { keyPath: 'key' })
        if (!d.objectStoreNames.contains('exports'))
          d.createObjectStore('exports', { keyPath: 'id' })
      },
    })
  }
  return dbp
}

function strip(item: QueueItem): StoredItem {
  const { file: _file, thumbBlob: _thumb, ...rest } = item
  return rest
}

export async function putItem(item: QueueItem) {
  ;(await db()).put('queue', strip(item))
}
// Ajout en masse (dossier de plusieurs milliers de fichiers): une seule
// transaction au lieu d'une par fichier, sinon l'ajout prend des minutes.
export async function putItems(items: QueueItem[]) {
  const d = await db()
  const tx = d.transaction('queue', 'readwrite')
  for (const it of items) tx.store.put(strip(it))
  await tx.done
}

// --- Octets ---

/** Écrit les octets une fois pour toutes, pour pouvoir reprendre l'envoi
 *  après fermeture de l'app. Peut échouer si le stockage est plein: l'appelant
 *  décide alors de continuer sans reprise plutôt que d'abandonner l'envoi. */
export async function putBlob(id: string, file: File) {
  ;(await db()).put('blobs', { id, file })
}
export async function dropBlob(id: string) {
  ;(await db()).delete('blobs', id)
}

export async function deleteItem(id: string) {
  const d = await db()
  const tx = d.transaction(['queue', 'blobs'], 'readwrite')
  tx.objectStore('queue').delete(id)
  tx.objectStore('blobs').delete(id)
  await tx.done
}

export async function allItems(): Promise<QueueItem[]> {
  const d = await db()
  const rows = await d.getAll('queue')
  const out: QueueItem[] = []
  for (const r of rows) {
    const blob = await d.get('blobs', r.id)
    out.push(blob ? { ...r, file: blob.file } : { ...r })
  }
  return out
}

/** Supprime les octets qui ne servent plus: envoi terminé, ou ligne de file
 *  disparue. Appelé au démarrage, pour que le stockage ne gonfle jamais tout
 *  seul. */
export async function pruneBlobs(): Promise<void> {
  const d = await db()
  const rows = await d.getAll('queue')
  const keep = new Set(
    rows.filter((r) => r.status !== 'done' && r.status !== 'dedup').map((r) => r.id),
  )
  const ids = await d.getAllKeys('blobs')
  const tx = d.transaction('blobs', 'readwrite')
  for (const id of ids) if (!keep.has(id)) tx.store.delete(id)
  await tx.done
}

export async function getCachedHash(key: string): Promise<string | undefined> {
  return (await db()).get('hashcache', key).then((e) => e?.hash)
}
export async function setCachedHash(key: string, hash: string) {
  ;(await db()).put('hashcache', { key, hash })
}

// --- File des enregistrements ---

export async function allExports(): Promise<ExportItem[]> {
  const items = await (await db()).getAll('exports')
  return items.sort((a, b) => a.createdAt - b.createdAt)
}
export async function putExport(item: ExportItem) {
  ;(await db()).put('exports', item)
}
export async function putExports(items: ExportItem[]) {
  const d = await db()
  const tx = d.transaction('exports', 'readwrite')
  for (const it of items) tx.store.put(it)
  await tx.done
}
export async function deleteExport(id: string) {
  ;(await db()).delete('exports', id)
}

