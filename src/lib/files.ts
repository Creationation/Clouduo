import { supabase } from './supabase'
import type { FileRow, Folder, Scope, FileKind } from './types'

export type KindFilter = 'all' | 'photo' | 'video'

// Liste les fichiers actifs d'un scope/dossier, triés par date de prise desc.
export async function listFiles(opts: {
  scope: Scope
  folderId: string | null
  kind?: KindFilter
}): Promise<FileRow[]> {
  let q = supabase
    .from('files')
    .select('*')
    .eq('scope', opts.scope)
    .is('deleted_at', null)
    .order('taken_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  // Racine du scope: folder_id null. Sinon le dossier courant.
  q = opts.folderId ? q.eq('folder_id', opts.folderId) : q.is('folder_id', null)

  if (opts.kind && opts.kind !== 'all') q = q.eq('kind', opts.kind as FileKind)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as FileRow[]
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

export async function renameFile(id: string, name: string) {
  const { error } = await supabase.from('files').update({ name }).eq('id', id)
  if (error) throw error
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
