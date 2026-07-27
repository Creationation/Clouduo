-- ============================================================
-- Planification de la purge de la corbeille
--
-- Sans elle, rien ne libère jamais l'espace des fichiers supprimés: la
-- promesse « purgé après 30 jours » affichée dans la corbeille était fausse.
--
-- Le secret n'est PAS écrit dans ce fichier: une migration est versionnée, y
-- mettre le secret reviendrait à le publier sur GitHub — exactement l'erreur
-- qui a mis la clé Supabase en ligne le 2026-07-26. On expose donc une
-- fonction qui reçoit le secret en paramètre, appelée une seule fois hors
-- dépôt.
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function schedule_purge_trash(
  p_secret text,
  p_schedule text default '0 3 * * *'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  job_name constant text := 'purge-trash-daily';
  cmd text;
begin
  if p_secret is null or length(p_secret) < 16 then
    raise exception 'secret trop court';
  end if;

  -- Replanifier proprement plutôt que d'empiler les tâches.
  if exists (select 1 from cron.job where jobname = job_name) then
    perform cron.unschedule(job_name);
  end if;

  cmd := format(
    $cmd$select net.http_post(
      url := 'https://qfcfstpbjnytkxticzxi.supabase.co/functions/v1/purge-trash',
      headers := jsonb_build_object('x-cron-secret', %L, 'Content-Type', 'application/json'),
      body := '{}'::jsonb
    );$cmd$, p_secret);

  perform cron.schedule(job_name, p_schedule, cmd);
  return job_name || ' planifie: ' || p_schedule;
end;
$$;

-- Consultable sans exposer la commande, qui contient le secret.
create or replace function purge_schedule_status()
returns table (jobname text, schedule text, active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select j.jobname::text, j.schedule::text, j.active
  from cron.job j
  where j.jobname = 'purge-trash-daily';
$$;

revoke execute on function schedule_purge_trash(text, text) from anon, authenticated;
revoke execute on function purge_schedule_status() from anon;
