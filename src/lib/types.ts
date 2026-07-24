// Types partagés (miroir du schéma Postgres)

export type Role = 'owner' | 'member'
export type Scope = 'personal' | 'shared'
export type FileKind = 'photo' | 'video' | 'other'
export type TransferStatus = 'pending' | 'accepted' | 'declined'

export interface Profile {
  id: string
  display_name: string
  avatar_url: string | null
  role: Role
  created_at: string
}

export interface Folder {
  id: string
  owner_id: string | null
  parent_id: string | null
  name: string
  scope: Scope
  created_at: string
}

export interface FileRow {
  id: string
  owner_id: string | null
  folder_id: string | null
  scope: Scope
  name: string
  mime_type: string
  kind: FileKind
  size_bytes: number
  r2_key: string
  thumb_key: string | null
  width: number | null
  height: number | null
  duration_seconds: number | null
  content_hash: string | null
  transferred_from: string | null
  taken_at: string | null
  created_at: string
  deleted_at: string | null
}

export interface Transfer {
  id: string
  file_id: string
  from_user: string
  to_user: string
  note: string | null
  status: TransferStatus
  created_at: string
  resolved_at: string | null
}

export interface BackupState {
  id: string
  user_id: string
  device_label: string
  last_backup_at: string | null
  enabled: boolean
}
