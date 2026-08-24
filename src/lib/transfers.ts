import { supabase } from './supabase'
import type { FileRow, Transfer } from './types'

export async function createTransfer(
  fileId: string,
  toUser: string,
  note?: string,
  batchId?: string,
) {
  const { data: auth } = await supabase.auth.getUser()
  const { error } = await supabase.from('transfers').insert({
    file_id: fileId,
    from_user: auth.user!.id,
    to_user: toUser,
    note: note ?? null,
    batch_id: batchId ?? null,
  })
  if (error) throw error
}

export interface InboxTransfer extends Transfer {
  batch_id: string | null
  /** La ligne complète du fichier proposé. Lisible tant que le transfert est
   *  en attente (voir migration 20260824000011); null si l'expéditeur l'a
   *  supprimé entre temps. */
  file: FileRow | null
  sender: { display_name: string } | null
}

/** Un envoi: tous les fichiers partis d'un même geste, chez le même expéditeur. */
export interface InboxBatch {
  key: string
  fromUser: string
  senderName: string
  /** Le mot joint, s'il y en a un (le même pour tout l'envoi). */
  note: string | null
  /** Date du premier fichier de l'envoi. */
  createdAt: string
  transfers: InboxTransfer[]
  /** Les fichiers réellement lisibles, dans l'ordre d'envoi. */
  files: FileRow[]
  totalBytes: number
}

// Transferts reçus en attente, avec la ligne du fichier et le nom de l'expéditeur.
export async function listInbox(): Promise<InboxTransfer[]> {
  const { data: auth } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('transfers')
    .select(
      'id, file_id, from_user, to_user, note, status, created_at, resolved_at, batch_id, file:files(*), sender:profiles!transfers_from_user_fkey(display_name)',
    )
    .eq('to_user', auth.user!.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as InboxTransfer[]
}

/**
 * Regroupe les transferts en envois.
 *
 * `batch_id` donne le regroupement exact, mais il n'existe que depuis la
 * migration 20260824000011: les transferts déjà en attente ne l'ont pas. Pour
 * ceux-là on retombe sur « même expéditeur, même jour », ce qui reconstitue
 * l'essentiel sans risquer de mélanger deux expéditeurs.
 */
export function groupInbox(rows: InboxTransfer[]): InboxBatch[] {
  const map = new Map<string, InboxBatch>()
  for (const r of rows) {
    const key = r.batch_id
      ? `b:${r.batch_id}`
      : `d:${r.from_user}:${r.created_at.slice(0, 10)}`
    let g = map.get(key)
    if (!g) {
      g = {
        key,
        fromUser: r.from_user,
        senderName: r.sender?.display_name ?? '',
        note: r.note,
        createdAt: r.created_at,
        transfers: [],
        files: [],
        totalBytes: 0,
      }
      map.set(key, g)
    }
    g.transfers.push(r)
    if (r.file) {
      g.files.push(r.file)
      g.totalBytes += r.file.size_bytes
    }
    // Un mot joint sur n'importe quelle ligne de l'envoi vaut pour l'envoi.
    if (!g.note && r.note) g.note = r.note
  }
  // Envoi le plus récent en premier; à l'intérieur, ordre d'arrivée.
  return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function acceptTransfer(
  transferId: string,
  folderId: string | null = null,
): Promise<string> {
  const { data, error } = await supabase.rpc('accept_transfer', {
    p_transfer_id: transferId,
    p_folder_id: folderId,
  })
  if (error) throw error
  return data as string
}

export async function declineTransfer(transferId: string) {
  const { error } = await supabase.rpc('decline_transfer', {
    p_transfer_id: transferId,
  })
  if (error) throw error
}

// Tout un envoi d'un coup, côté base: un lot n'est plus laissé à moitié
// traité si le réseau tombe au milieu. Renvoie le nombre de lignes traitées.
export async function acceptBatch(
  ids: string[],
  folderId: string | null = null,
): Promise<number> {
  if (!ids.length) return 0
  const { data, error } = await supabase.rpc('accept_batch', {
    p_ids: ids,
    p_folder_id: folderId,
  })
  if (error) throw error
  return (data as number) ?? 0
}

export async function declineBatch(ids: string[]): Promise<number> {
  if (!ids.length) return 0
  const { data, error } = await supabase.rpc('decline_batch', { p_ids: ids })
  if (error) throw error
  return (data as number) ?? 0
}
