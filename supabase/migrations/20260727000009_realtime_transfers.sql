-- ============================================================
-- Temps réel sur les transferts
--
-- Le badge « Reçus » se met à jour via postgres_changes sur `transfers`.
-- Encore faut-il que la table soit publiée : sans ça l'abonnement se
-- connecte sans erreur mais ne reçoit jamais rien, et le badge reste affiché
-- après acceptation jusqu'au prochain rechargement de la page.
--
-- REPLICA IDENTITY FULL est nécessaire pour que les UPDATE transportent
-- l'ancienne ligne : sans elle, le filtrage côté client sur to_user ne peut
-- pas fonctionner sur une modification.
-- ============================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'transfers'
    ) then
      alter publication supabase_realtime add table public.transfers;
    end if;
  end if;
end $$;

alter table public.transfers replica identity full;
