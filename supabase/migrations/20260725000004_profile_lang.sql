-- Langue de l'interface attachée au compte (et non au navigateur), pour que
-- chacun retrouve la sienne sur n'importe quel appareil.
alter table profiles
  add column if not exists lang text not null default 'fr'
  check (lang in ('fr', 'de'));

-- Reprend la langue passée en User Metadata à la création du compte.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role, lang)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'member'),
    case when new.raw_user_meta_data->>'lang' in ('fr', 'de')
         then new.raw_user_meta_data->>'lang'
         else 'fr' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
