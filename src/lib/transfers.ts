import { supabase } from './supabase'
import type { Transfer } from './types'

export async function createTransfer(
  fileId: string,
  toUser: string,
  note?: string,
) {
  const { data: auth } = await supabase.auth.getUser()
  const { error } = await supabase.from('transfers').insert({
    file_id: fileId,
    from_user: auth.user!.id,
    to_user: toUser,
    note: note ?? null,
  })
  if (error) throw error
}

export interface InboxTransfer extends Transfer {
  file: {
    name: string
    kind: string
    thumb_key: string | null
    size_bytes: number
  } | null
  sender: { display_name: string } | null
}

// Transferts reçus en attente, avec aperçu du fichier et nom de l'expéditeur.
export async function listInbox(): Promise<InboxTransfer[]> {
  const { data: auth } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('transfers')
    .select(
      'id, file_id, from_user, to_user, note, status, created_at, resolved_at, file:files(name,kind,thumb_key,size_bytes), sender:profiles!transfers_from_user_fkey(display_name)',
    )
    .eq('to_user', auth.user!.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as InboxTransfer[]
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
