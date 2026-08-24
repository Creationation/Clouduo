-- ============================================================
-- find_duplicate_groups: rendre les droits eleves inutiles
--
-- La version precedente etait `security definer` par prudence mal placee.
-- Elle n'en a aucun besoin: son filtre (`owner_id = auth.uid() or scope =
-- 'shared'`) donne exactement le meme resultat que la RLS. Une fonction qui
-- contourne la RLS sans necessite est une dette: le jour ou son filtre est
-- modifie par inadvertance, plus rien ne rattrape l'erreur.
-- ============================================================

create or replace function find_duplicate_groups()
returns table (
  content_hash text,
  scope text,
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
security invoker
set search_path = public
as $$
  select
    f.content_hash,
    f.scope,
    count(*)::int                                        as copies,
    count(distinct f.r2_key)::int                        as distinct_objects,
    max(f.size_bytes)                                    as size_bytes,
    max(f.size_bytes) * (count(distinct f.r2_key) - 1)   as wasted_bytes,
    min(f.name)                                          as sample_name,
    min(f.kind)                                          as kind,
    array_agg(f.id order by f.created_at, f.id)          as ids
  from files f
  where f.deleted_at is null
    and f.content_hash is not null
    and (f.owner_id = auth.uid() or f.scope = 'shared')
  group by f.content_hash, f.scope
  having count(*) > 1
  order by
    max(f.size_bytes) * (count(distinct f.r2_key) - 1) desc,
    count(*) desc;
$$;
