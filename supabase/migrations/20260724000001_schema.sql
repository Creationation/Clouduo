-- ============================================================
-- NuageDuo — Schéma
-- ============================================================

-- Profils (liés à auth.users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now()
);

-- Dossiers. scope 'personal' = privé au propriétaire, 'shared' = espace commun visible par les deux
create table if not exists folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade,
  parent_id uuid references folders(id) on delete cascade,
  name text not null,
  scope text not null default 'personal' check (scope in ('personal','shared')),
  created_at timestamptz not null default now(),
  constraint scope_owner check (scope = 'shared' or owner_id is not null)
);

-- Fichiers
create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade,
  folder_id uuid references folders(id) on delete set null,
  scope text not null default 'personal' check (scope in ('personal','shared')),
  name text not null,
  mime_type text not null,
  kind text not null check (kind in ('photo','video','other')),
  size_bytes bigint not null,
  r2_key text not null,           -- clé de l'objet original dans R2
  thumb_key text,                 -- clé de la miniature (nullable)
  width int,
  height int,
  duration_seconds numeric,       -- pour les vidéos
  content_hash text,              -- sha-256 côté client, pour dédup
  transferred_from uuid references profiles(id),
  taken_at timestamptz,           -- date EXIF si dispo, sinon date fichier
  created_at timestamptz not null default now(),
  deleted_at timestamptz          -- corbeille, purge après 30 jours
);

-- Transferts (boîte de réception)
create table if not exists transfers (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files(id) on delete cascade,
  from_user uuid not null references profiles(id),
  to_user uuid not null references profiles(id),
  note text,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- État du backup automatique par appareil
create table if not exists backup_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  device_label text not null,
  last_backup_at timestamptz,
  enabled boolean not null default false,
  unique (user_id, device_label)
);

-- ----------------------------------------------------------
-- Index (galerie triée par date, navigation dossiers, dédup, ref-counting R2)
-- ----------------------------------------------------------
create index if not exists files_gallery_idx
  on files (owner_id, scope, taken_at desc)
  where deleted_at is null;

create index if not exists files_folder_idx on files (folder_id) where deleted_at is null;
create index if not exists files_scope_idx on files (scope, taken_at desc) where deleted_at is null;
create index if not exists files_r2key_idx on files (r2_key);
create index if not exists files_hash_idx on files (owner_id, content_hash);
create index if not exists files_trash_idx on files (deleted_at) where deleted_at is not null;

create index if not exists folders_owner_idx on folders (owner_id, scope);
create index if not exists folders_parent_idx on folders (parent_id);

create index if not exists transfers_to_idx on transfers (to_user, status);
create index if not exists transfers_from_idx on transfers (from_user);
