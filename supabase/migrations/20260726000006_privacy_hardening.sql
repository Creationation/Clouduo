-- ============================================================
-- Étanchéité des espaces privés
--
-- Chaque espace personnel doit être invisible à l'autre. Le Commun est le
-- SEUL endroit partagé. La lecture était déjà correcte (RLS sur files et
-- folders), mais les transferts ouvraient une brèche:
--
--   "create transfers" ne vérifiait que from_user = auth.uid(), jamais que
--   file_id appartenait à l'expéditeur. On pouvait donc s'auto-envoyer
--   l'identifiant d'un fichier privé de l'autre, puis accepter: accept_transfer
--   étant SECURITY DEFINER (il doit l'être, le destinataire ne peut pas lire la
--   source), la copie se faisait sans contrôle de propriété.
--
--   L'identifiant est un uuid v4, donc non devinable en pratique. La faille
--   n'était pas exploitable sans fuite d'id, mais elle ne doit pas exister.
-- ============================================================

drop policy if exists "create transfers" on transfers;
create policy "create transfers" on transfers for insert to authenticated
  with check (
    from_user = auth.uid()
    and exists (
      select 1 from files f
       where f.id = file_id
         and f.owner_id = auth.uid()
         and f.deleted_at is null
    )
  );

-- Ceinture et bretelles: accept_transfer revérifie la propriété au moment de
-- l'acceptation. Un fichier peut avoir changé de mains entre l'envoi et
-- l'acceptation, et cette fonction contourne la RLS par construction.
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

  select * into src from files where id = t.file_id and deleted_at is null;
  if not found then
    raise exception 'fichier source supprimé';
  end if;

  -- L'expéditeur doit toujours être propriétaire de ce qu'il envoie.
  if src.owner_id is distinct from t.from_user then
    raise exception 'transfert invalide';
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

-- ============================================================
-- Anti-force brute sur la connexion
--
-- auth-username appelle Supabase Auth côté serveur: du point de vue de
-- Supabase toutes les tentatives viennent de la même IP (celle de la Edge
-- Function), donc sa limitation par IP ne protège plus rien. On compte donc
-- nous-mêmes les échecs par nom d'utilisateur.
-- ============================================================
create table if not exists auth_throttle (
  username text primary key,
  fails int not null default 0,
  first_fail_at timestamptz not null default now(),
  blocked_until timestamptz
);

-- Table interne: aucun accès client, seul le service_role la touche.
alter table auth_throttle enable row level security;

-- Retourne true si la tentative est autorisée.
create or replace function login_allowed(p_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  row auth_throttle%rowtype;
begin
  select * into row from auth_throttle where username = lower(p_username);
  if not found then
    return true;
  end if;
  if row.blocked_until is not null and row.blocked_until > now() then
    return false;
  end if;
  return true;
end;
$$;

-- Enregistre le résultat d'une tentative. 5 échecs en 15 min => blocage 15 min.
create or replace function login_record(p_username text, p_success boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  u text := lower(p_username);
begin
  if p_success then
    delete from auth_throttle where username = u;
    return;
  end if;

  insert into auth_throttle (username, fails, first_fail_at)
  values (u, 1, now())
  on conflict (username) do update set
    -- Fenêtre glissante: au-delà de 15 min sans échec, on repart de zéro.
    fails = case
      when auth_throttle.first_fail_at < now() - interval '15 minutes' then 1
      else auth_throttle.fails + 1
    end,
    first_fail_at = case
      when auth_throttle.first_fail_at < now() - interval '15 minutes' then now()
      else auth_throttle.first_fail_at
    end;

  update auth_throttle
     set blocked_until = now() + interval '15 minutes'
   where username = u and fails >= 5;
end;
$$;

-- Seul le service_role (Edge Function) peut appeler ces deux fonctions.
revoke execute on function login_allowed(text) from anon, authenticated;
revoke execute on function login_record(text, boolean) from anon, authenticated;
