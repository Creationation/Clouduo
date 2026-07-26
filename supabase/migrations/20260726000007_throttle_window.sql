-- ============================================================
-- Correction du compteur anti-force-brute
--
-- Deux défauts constatés en usage réel le 2026-07-26 :
--
-- 1. La fenêtre de 15 min était ancrée sur le PREMIER échec. Des tentatives
--    ratées avant une réinitialisation de mot de passe continuaient donc de
--    compter après, et l'utilisateur se retrouvait bloqué alors qu'il venait
--    de définir un mot de passe valide. On glisse désormais la fenêtre sur le
--    DERNIER échec, ce qui est le comportement attendu.
--
-- 2. Rien ne remettait le compteur à zéro après un changement de mot de passe.
--    Les échecs d'avant n'ont plus aucun sens une fois le mot de passe changé.
-- ============================================================

alter table auth_throttle
  add column if not exists last_fail_at timestamptz not null default now();

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

  insert into auth_throttle (username, fails, first_fail_at, last_fail_at)
  values (u, 1, now(), now())
  on conflict (username) do update set
    -- Fenêtre glissante sur le dernier échec: 15 min de calme = repart à zéro.
    fails = case
      when auth_throttle.last_fail_at < now() - interval '15 minutes' then 1
      else auth_throttle.fails + 1
    end,
    first_fail_at = case
      when auth_throttle.last_fail_at < now() - interval '15 minutes' then now()
      else auth_throttle.first_fail_at
    end,
    last_fail_at = now(),
    blocked_until = null;

  update auth_throttle
     set blocked_until = now() + interval '15 minutes'
   where username = u and fails >= 5;
end;
$$;

-- Un changement de mot de passe efface l'ardoise: les échecs précédents
-- portaient sur un mot de passe qui n'existe plus.
create or replace function clear_throttle_on_password_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    delete from auth_throttle where username = lower(new.email);
  end if;
  return new;
end;
$$;

drop trigger if exists on_password_changed on auth.users;
create trigger on_password_changed
  after update on auth.users
  for each row execute function clear_throttle_on_password_change();

revoke execute on function login_record(text, boolean) from anon, authenticated;
