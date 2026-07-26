-- Connexion par nom d'utilisateur. L'email reste attaché au compte (Supabase
-- Auth en a besoin) mais ne sert plus qu'à la récupération de mot de passe.
alter table profiles add column if not exists username text;

-- Reprise des comptes existants: la partie avant @ de leur email.
update profiles p
   set username = split_part(u.email, '@', 1)
  from auth.users u
 where u.id = p.id and p.username is null;

create unique index if not exists profiles_username_key
  on profiles (lower(username));

alter table profiles alter column username set not null;

-- Le username vient des User Metadata à la création, sinon on retombe sur la
-- partie locale de l'email.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role, lang, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'member'),
    case when new.raw_user_meta_data->>'lang' in ('fr', 'de')
         then new.raw_user_meta_data->>'lang'
         else 'fr' end,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
