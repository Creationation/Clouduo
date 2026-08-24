-- ============================================================
-- Reçu en double: plus jamais
--
-- Trois trous, qui se cumulent:
--
-- 1) Rien n'empêchait DEUX transferts en attente du même fichier vers la même
--    personne. C'est exactement ce qui arrive quand un envoi a été relancé
--    après un plantage: la déduplication à l'envoi voit que le fichier est
--    déjà chez l'expéditeur, ne le renvoie pas... et crée quand même un
--    second transfert. Deux propositions, deux acceptations, deux exemplaires.
--
-- 2) accept_transfer copiait sans jamais regarder si le destinataire avait
--    déjà ce contenu. L'envoi, lui, déduplique depuis le début (owner_id +
--    content_hash). La réception doit appliquer la même règle.
--
-- 3) Un envoi interrompu côté réseau pouvait insérer la ligne `files` deux
--    fois (la réponse perdue est indistinguable d'un échec). Traité côté app,
--    mais la garde ci-dessous rattrape aussi ce cas.
-- ============================================================

-- Nettoyage AVANT l'index unique: on garde la proposition la plus récente et
-- on classe les autres comme refusées (elles n'ont jamais rien apporté).
update transfers t
   set status = 'declined', resolved_at = now()
 where t.status = 'pending'
   and exists (
     select 1 from transfers u
      where u.file_id = t.file_id
        and u.to_user = t.to_user
        and u.status = 'pending'
        and (u.created_at, u.id) > (t.created_at, t.id)
   );

-- Une seule proposition en attente par (fichier, destinataire).
create unique index if not exists transfers_pending_unique_idx
  on transfers (file_id, to_user)
  where status = 'pending';

-- ------------------------------------------------------------
-- Acceptation: ne jamais créer un second exemplaire du même contenu.
-- ------------------------------------------------------------
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

  -- Déjà chez moi ? Alors on marque accepté et on rend la ligne existante.
  -- Le contenu fait référence (content_hash), la clé R2 sert de secours pour
  -- les lignes anciennes qui n'ont pas de hash.
  if src.content_hash is not null then
    select f.id into new_id from files f
     where f.owner_id = auth.uid()
       and f.content_hash = src.content_hash
       and f.deleted_at is null
     limit 1;
  else
    select f.id into new_id from files f
     where f.owner_id = auth.uid()
       and f.r2_key = src.r2_key
       and f.deleted_at is null
     limit 1;
  end if;

  if new_id is null then
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
  end if;

  update transfers set status = 'accepted', resolved_at = now()
   where id = p_transfer_id;

  return new_id;
end;
$$;
