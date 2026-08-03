import { supabase } from './supabase'
import type { FileRow, Folder, Scope, FileKind } from './types'

export type KindFilter = 'all' | 'photo' | 'video'

// Liste les fichiers actifs d'un scope/dossier, triés chronologiquement sur
// taken_at (la date éditable), created_at ne servant que de départage.
export async function listFiles(opts: {
  scope: Scope
  folderId: string | null
  kinds?: FileKind[]
  asc?: boolean
}): Promise<FileRow[]> {
  const asc = opts.asc ?? false
  let q = supabase
    .from('files')
    .select('*')
    .eq('scope', opts.scope)
    .is('deleted_at', null)
    .order('taken_at', { ascending: asc, nullsFirst: false })
    .order('created_at', { ascending: asc })

  // Racine du scope: folder_id null. Sinon le dossier courant.
  q = opts.folderId ? q.eq('folder_id', opts.folderId) : q.is('folder_id', null)

  if (opts.kinds?.length) q = q.in('kind', opts.kinds)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as FileRow[]
}

/**
 * PostgREST met les filtres dans l'adresse: un `in.(...)` de 200 identifiants
 * dépasse la longueur d'URL admise et la requête est refusée avant même
 * d'atteindre la base. Avec « Tout sélectionner » sur une bonne journée de
 * photos, c'est vite atteint. On découpe donc en lots.
 */
const ID_BATCH = 80

async function inBatches(ids: string[], run: (batch: string[]) => Promise<void>) {
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    await run(ids.slice(i, i + ID_BATCH))
  }
}

// Déplace des fichiers vers un dossier (null = racine du scope). Seule la
// ligne change, l'objet R2 n'est pas déplacé ni réécrit.
export async function moveFiles(ids: string[], folderId: string | null) {
  if (!ids.length) return
  await inBatches(ids, async (batch) => {
    const { error } = await supabase
      .from('files')
      .update({ folder_id: folderId })
      .in('id', batch)
    if (error) throw error
  })
}

/**
 * DÉPLACE des fichiers vers le Commun: la ligne elle-même change de scope,
 * elle disparaît donc de l'espace perso. À distinguer de copyFile, qui laisse
 * l'original en place et crée une seconde référence.
 *
 * Dans les deux cas l'objet R2 n'est ni recopié ni déplacé: seul le stockage
 * logique change, les octets ne bougent pas.
 */
export async function moveToShared(ids: string[]) {
  if (!ids.length) return
  await inBatches(ids, async (batch) => {
    const { error } = await supabase
      .from('files')
      .update({ scope: 'shared', folder_id: null })
      .in('id', batch)
    if (error) throw error
  })
}

export interface FolderNode extends Folder {
  depth: number
}

// Tous les dossiers d'un scope, aplatis dans l'ordre de l'arbre, avec leur
// profondeur: sert au sélecteur de destination.
export async function listFolderTree(scope: Scope): Promise<FolderNode[]> {
  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .eq('scope', scope)
    .order('name')
  if (error) throw error

  const all = (data ?? []) as Folder[]
  const byParent = new Map<string | null, Folder[]>()
  for (const f of all) {
    const k = f.parent_id
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(f)
  }
  const out: FolderNode[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const f of byParent.get(parent) ?? []) {
      out.push({ ...f, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export async function getFile(id: string): Promise<FileRow | null> {
  const { data } = await supabase.from('files').select('*').eq('id', id).single()
  return (data as FileRow) ?? null
}

export async function listFolders(
  scope: Scope,
  parentId: string | null,
): Promise<Folder[]> {
  let q = supabase
    .from('folders')
    .select('*')
    .eq('scope', scope)
    .order('name')
  q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as Folder[]
}

export async function createFolder(
  name: string,
  scope: Scope,
  parentId: string | null,
): Promise<Folder> {
  const { data: auth } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('folders')
    .insert({ name, scope, parent_id: parentId, owner_id: auth.user!.id })
    .select('*')
    .single()
  if (error) throw error
  return data as Folder
}

/**
 * Modifie le nom et/ou la date du fichier. taken_at commande le classement
 * chronologique de la galerie (tri et regroupement par mois): la changer
 * déplace le fichier dans la timeline. Les octets stockés ne bougent pas,
 * seule la ligne en base est modifiée.
 */
export async function updateFileInfo(
  id: string,
  patch: { name?: string; taken_at?: string | null },
) {
  const { error } = await supabase.from('files').update(patch).eq('id', id)
  if (error) throw error
}

// <input type="datetime-local"> parle heure locale, la base stocke de l'UTC.
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

export function localInputToIso(value: string): string | null {
  const d = new Date(value) // sans suffixe Z, interprété en heure locale
  return isNaN(d.getTime()) ? null : d.toISOString()
}

// Suppression = corbeille (deleted_at). L'objet R2 n'est PAS touché ici.
export async function trashFile(id: string) {
  const { error } = await supabase
    .from('files')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function restoreFile(id: string) {
  const { error } = await supabase
    .from('files')
    .update({ deleted_at: null })
    .eq('id', id)
  if (error) throw error
}

export async function listTrash(): Promise<FileRow[]> {
  const { data: auth } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('files')
    .select('*')
    .eq('owner_id', auth.user!.id)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as FileRow[]
}

// Crée une référence (même r2_key) via RPC SECURITY DEFINER: aucun re-upload.
export async function copyFile(
  fileId: string,
  targetScope: Scope,
  folderId: string | null = null,
): Promise<string> {
  const { data, error } = await supabase.rpc('copy_file', {
    p_file_id: fileId,
    p_target_scope: targetScope,
    p_folder_id: folderId,
  })
  if (error) throw error
  return data as string
}
