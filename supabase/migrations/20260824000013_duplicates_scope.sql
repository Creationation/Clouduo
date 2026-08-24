-- ============================================================
-- Doublons: ne plus proposer de supprimer ce qui doit rester
--
-- Le regroupement se faisait sur la seule empreinte, sur TOUT ce que la RLS
-- laissait voir. Trois consequences, toutes mauvaises:
--
-- 1) Une photo a moi et sa copie dans le Commun formaient un "doublon". Or
--    c'est exactement ce que fait "Mettre dans le Commun": deux lignes sur le
--    MEME objet R2, qui ne coute rien de plus. Nettoyer le groupe faisait
--    disparaitre la copie commune, donc le partage lui-meme.
--
-- 2) Depuis la migration 20260824000011, un fichier en attente d'acceptation
--    est lisible par son destinataire. Il entrait donc dans les groupes, et
--    "garder un seul exemplaire" pouvait envoyer a la corbeille un fichier
--    qui ne nous appartient pas encore, avant meme de l'avoir accepte.
--
-- 3) Le tri interne ne departageait pas les egalites de date: deux lignes
--    creees dans la meme transaction pouvaient changer d'ordre d'un appel a
--    l'autre, et "le plus ancien" n'etait pas toujours le meme.
--
-- Desormais: un groupe ne melange jamais deux espaces, ne contient que ce
-- qu'on a le droit de ranger (a moi, ou dans le Commun), et son ordre est
-- stable.
-- ============================================================

drop function if exists find_duplicate_groups();

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
security definer
set search_path = public
as $$
  select
    f.content_hash,
    f.scope,
    count(*)::int                                        as copies,
    count(distinct f.r2_key)::int                        as distinct_objects,
    max(f.size_bytes)                                    as size_bytes,
    -- Seuls les objets R2 distincts en trop occupent vraiment de la place.
    max(f.size_bytes) * (count(distinct f.r2_key) - 1)   as wasted_bytes,
    min(f.name)                                          as sample_name,
    min(f.kind)                                          as kind,
    -- L'identifiant departage les dates egales: l'ordre ne bouge plus d'un
    -- appel a l'autre, donc "le plus ancien" designe toujours la meme ligne.
    array_agg(f.id order by f.created_at, f.id)          as ids
  from files f
  where f.deleted_at is null
    and f.content_hash is not null
    -- Ce qu'on peut ranger: mes fichiers, et le Commun qui est a nous deux.
    -- Exclut de fait les fichiers seulement proposes: ils appartiennent
    -- encore a l'expediteur tant qu'ils ne sont pas acceptes.
    and (f.owner_id = auth.uid() or f.scope = 'shared')
  group by f.content_hash, f.scope
  having count(*) > 1
  order by
    max(f.size_bytes) * (count(distinct f.r2_key) - 1) desc,
    count(*) desc;
$$;

grant execute on function find_duplicate_groups() to authenticated;
