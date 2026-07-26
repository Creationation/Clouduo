-- ============================================================
-- Détecteur de doublons
--
-- La dédup à l'upload empêche de RE-téléverser un fichier déjà présent, mais
-- elle ne nettoie pas ce qui est déjà là : fichiers importés avant sa mise en
-- place, copies récupérées depuis le Commun, mêmes photos arrivées par des
-- chemins différents. Cette fonction regroupe par empreinte sha-256.
--
-- Distinction importante affichée à l'utilisateur :
--   - plusieurs lignes pointant sur le MÊME objet R2 = simples références,
--     elles ne coûtent aucun espace supplémentaire ;
--   - plusieurs objets R2 distincts = espace réellement gaspillé.
--
-- SECURITY INVOKER (défaut) : la RLS s'applique, on ne voit donc jamais les
-- doublons de l'espace privé de l'autre.
-- ============================================================
create or replace function find_duplicate_groups()
returns table (
  content_hash text,
  copies int,
  distinct_objects int,
  size_bytes bigint,
  wasted_bytes bigint,
  sample_name text,
  kind text,
  ids uuid[]
)
language sql
stable
set search_path = public
as $$
  select
    f.content_hash,
    count(*)::int                                        as copies,
    count(distinct f.r2_key)::int                        as distinct_objects,
    max(f.size_bytes)                                    as size_bytes,
    -- Seuls les objets R2 distincts en trop occupent vraiment de la place.
    max(f.size_bytes) * (count(distinct f.r2_key) - 1)   as wasted_bytes,
    min(f.name)                                          as sample_name,
    min(f.kind)                                          as kind,
    array_agg(f.id order by f.created_at)                as ids
  from files f
  where f.deleted_at is null
    and f.content_hash is not null
  group by f.content_hash
  having count(*) > 1
  order by
    max(f.size_bytes) * (count(distinct f.r2_key) - 1) desc,
    count(*) desc;
$$;
