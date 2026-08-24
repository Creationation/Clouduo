-- ============================================================
-- Boîte de réception: un envoi groupé, et des aperçus qui s'affichent
--
-- Deux manques, tous les deux visibles à l'écran:
--
-- 1) Le destinataire ne pouvait RIEN lire du fichier en attente. La seule
--    politique de lecture sur `files` est « scope = shared ou owner_id = moi »,
--    or un transfert en attente porte sur un fichier PERSONNEL de l'expéditeur.
--    La jointure `file:files(...)` de la boîte de réception renvoyait donc null:
--    pas de nom, pas de taille, pas de miniature, et surtout aucune lecture
--    possible (sign-download s'appuie sur cette même RLS). On acceptait à
--    l'aveugle. On ouvre donc la lecture, strictement le temps de l'attente:
--    l'expéditeur a explicitement choisi d'envoyer ce fichier, et le refus
--    comme l'acceptation referment l'accès aussitôt.
--
-- 2) Rien ne reliait entre eux les fichiers d'un même envoi. Vingt photos
--    envoyées d'un coup donnaient vingt lignes indépendantes, donc vingt
--    cartes à traiter une par une. `batch_id` marque l'envoi.
-- ============================================================

alter table transfers add column if not exists batch_id uuid;

-- Sert au regroupement de la boîte de réception.
create index if not exists transfers_batch_idx
  on transfers (to_user, batch_id)
  where status = 'pending';

-- Sert à la politique ci-dessous: elle est évaluée pour chaque ligne `files`
-- lue, donc l'existence doit se répondre par un index.
create index if not exists transfers_pending_file_idx
  on transfers (file_id, to_user)
  where status = 'pending';

-- Lecture d'un fichier qui m'est proposé, tant qu'il est en attente.
-- Ne donne accès qu'à la ligne (nom, taille, clés R2 pour l'aperçu et la
-- lecture), jamais au reste de l'espace privé de l'expéditeur.
drop policy if exists "read files awaiting me" on files;
create policy "read files awaiting me" on files for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from transfers tr
       where tr.file_id = files.id
         and tr.to_user = auth.uid()
         and tr.status = 'pending'
    )
  );

-- Refuser tout un envoi d'un coup, en une seule transaction. Le faire ligne
-- par ligne depuis le téléphone marchait, mais laissait un lot à moitié traité
-- si le réseau tombait au milieu.
create or replace function decline_batch(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is null then
    raise exception 'non authentifié';
  end if;
  update transfers
     set status = 'declined', resolved_at = now()
   where id = any(p_ids)
     and to_user = auth.uid()
     and status = 'pending';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Accepter tout un envoi d'un coup. Réutilise accept_transfer pour garder un
-- seul endroit où vit le contrôle de propriété.
create or replace function accept_batch(
  p_ids uuid[],
  p_folder_id uuid default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid;
  n int := 0;
begin
  if auth.uid() is null then
    raise exception 'non authentifié';
  end if;
  foreach tid in array p_ids loop
    -- Un fichier supprimé entre temps ne doit pas faire échouer les autres.
    begin
      perform accept_transfer(tid, p_folder_id);
      n := n + 1;
    exception when others then
      null;
    end;
  end loop;
  return n;
end;
$$;

grant execute on function accept_batch(uuid[], uuid) to authenticated;
grant execute on function decline_batch(uuid[]) to authenticated;
