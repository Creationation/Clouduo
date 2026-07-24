-- ============================================================
-- NuageDuo — Triggers & RPC
-- ============================================================

-- ----------------------------------------------------------
-- Création automatique du profil à l'inscription d'un utilisateur.
-- Les 2 comptes étant créés à la main dans Supabase, on lit display_name/role
-- depuis user_metadata si présents.
-- ----------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'member')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ----------------------------------------------------------
-- copy_file: crée une NOUVELLE ligne files pointant vers le MÊME r2_key.
-- Sert à "Récupérer depuis le Commun" (shared -> personal) et
-- "Mettre dans le Commun" (personal -> shared). Aucun re-upload.
-- ----------------------------------------------------------
create or replace function copy_file(
  p_file_id uuid,
  p_target_scope text,
  p_folder_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  src files%rowtype;
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'non authentifié';
  end if;
  if p_target_scope not in ('personal','shared') then
    raise exception 'scope invalide';
  end if;

  select * into src from files
   where id = p_file_id and deleted_at is null;
  if not found then
    raise exception 'fichier introuvable';
  end if;

  -- Accès: le fichier source doit être commun, ou m'appartenir.
  if not (src.scope = 'shared' or src.owner_id = auth.uid()) then
    raise exception 'accès refusé';
  end if;

  insert into files (
    owner_id, folder_id, scope, name, mime_type, kind, size_bytes,
    r2_key, thumb_key, width, height, duration_seconds, content_hash, taken_at
  ) values (
    auth.uid(), p_folder_id, p_target_scope, src.name, src.mime_type, src.kind, src.size_bytes,
    src.r2_key, src.thumb_key, src.width, src.height, src.duration_seconds, src.content_hash, src.taken_at
  )
  returning id into new_id;

  return new_id;
end;
$$;

-- ----------------------------------------------------------
-- accept_transfer: le destinataire accepte -> nouvelle ligne files chez lui
-- (référence au même r2_key), transfert marqué 'accepted'.
-- SECURITY DEFINER car le destinataire ne peut pas lire (RLS) le fichier
-- source qui appartient à l'expéditeur en scope personnel.
-- ----------------------------------------------------------
create or replace function accept_transfer(
  p_transfer_id uuid,
  p_folder_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t transfers%rowtype;
  src files%rowtype;
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'non authentifié';
  end if;

  select * into t from transfers
   where id = p_transfer_id and to_user = auth.uid() and status = 'pending';
  if not found then
    raise exception 'transfert introuvable ou déjà traité';
  end if;

  select * into src from files where id = t.file_id;
  if not found then
    raise exception 'fichier source supprimé';
  end if;

  insert into files (
    owner_id, folder_id, scope, name, mime_type, kind, size_bytes,
    r2_key, thumb_key, width, height, duration_seconds, content_hash,
    taken_at, transferred_from
  ) values (
    auth.uid(), p_folder_id, 'personal', src.name, src.mime_type, src.kind, src.size_bytes,
    src.r2_key, src.thumb_key, src.width, src.height, src.duration_seconds, src.content_hash,
    src.taken_at, t.from_user
  )
  returning id into new_id;

  update transfers set status = 'accepted', resolved_at = now()
   where id = p_transfer_id;

  return new_id;
end;
$$;

create or replace function decline_transfer(p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update transfers set status = 'declined', resolved_at = now()
   where id = p_transfer_id and to_user = auth.uid() and status = 'pending';
end;
$$;

-- ----------------------------------------------------------
-- get_storage_stats: octets/compte par bucket. Dédup physique par r2_key
-- (un même objet référencé plusieurs fois ne coûte l'espace qu'une fois).
-- L'owner obtient le détail par utilisateur (impossible via RLS directe).
-- ----------------------------------------------------------
create or replace function get_storage_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_role text;
  result jsonb;
  per_user jsonb;
begin
  if me is null then
    raise exception 'non authentifié';
  end if;
  select role into my_role from profiles where id = me;

  -- Buckets du caller (octets dédupliqués par r2_key à l'intérieur du bucket)
  result := jsonb_build_object(
    'mine', (
      select jsonb_build_object('bytes', coalesce(sum(sz),0), 'count', count(*))
      from (select distinct on (r2_key) size_bytes sz from files
            where owner_id = me and scope = 'personal' and deleted_at is null
            order by r2_key) q
    ),
    'shared', (
      select jsonb_build_object('bytes', coalesce(sum(sz),0), 'count', count(*))
      from (select distinct on (r2_key) size_bytes sz from files
            where scope = 'shared' and deleted_at is null
            order by r2_key) q
    ),
    'trash', (
      select jsonb_build_object('bytes', coalesce(sum(size_bytes),0), 'count', count(*))
      from files where owner_id = me and deleted_at is not null
    ),
    -- Coût de stockage réel: objets R2 distincts encore référencés (actifs ou corbeille)
    'physical_total', (
      select jsonb_build_object('bytes', coalesce(sum(sz),0), 'count', count(*))
      from (select distinct on (r2_key) size_bytes sz from files order by r2_key) q
    )
  );

  -- Détail par utilisateur, réservé à l'owner
  if my_role = 'owner' then
    select jsonb_agg(row_to_json(u)) into per_user from (
      select
        p.id,
        p.display_name,
        (select coalesce(sum(sz),0) from (
           select distinct on (r2_key) size_bytes sz from files
           where owner_id = p.id and scope = 'personal' and deleted_at is null
           order by r2_key) q) as personal_bytes,
        (select count(*) from files
           where owner_id = p.id and scope = 'personal' and deleted_at is null) as personal_count
      from profiles p
      order by p.display_name
    ) u;
    result := result || jsonb_build_object('per_user', coalesce(per_user, '[]'::jsonb));
  end if;

  return result;
end;
$$;

-- Autorisations d'exécution
grant execute on function copy_file(uuid, text, uuid) to authenticated;
grant execute on function accept_transfer(uuid, uuid) to authenticated;
grant execute on function decline_transfer(uuid) to authenticated;
grant execute on function get_storage_stats() to authenticated;
