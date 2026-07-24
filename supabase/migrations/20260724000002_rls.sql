-- ============================================================
-- NuageDuo — Row Level Security
-- ============================================================

alter table profiles enable row level security;
alter table folders enable row level security;
alter table files enable row level security;
alter table transfers enable row level security;
alter table backup_state enable row level security;

-- profiles: chacun lit les 2 profils (nécessaire pour "Envoyer à..."), modifie uniquement le sien
create policy "read all profiles" on profiles for select to authenticated using (true);
create policy "update own profile" on profiles for update to authenticated using (id = auth.uid());

-- folders: accès si personnel à soi OU shared
create policy "read folders" on folders for select to authenticated
  using (scope = 'shared' or owner_id = auth.uid());
create policy "insert folders" on folders for insert to authenticated
  with check (owner_id = auth.uid());
create policy "update folders" on folders for update to authenticated
  using (scope = 'shared' or owner_id = auth.uid());
create policy "delete folders" on folders for delete to authenticated
  using (scope = 'shared' or owner_id = auth.uid());

-- files: même logique
create policy "read files" on files for select to authenticated
  using (scope = 'shared' or owner_id = auth.uid());
create policy "insert files" on files for insert to authenticated
  with check (owner_id = auth.uid());
create policy "update files" on files for update to authenticated
  using (scope = 'shared' or owner_id = auth.uid());
create policy "delete files" on files for delete to authenticated
  using (scope = 'shared' or owner_id = auth.uid());

-- transfers: visibles par expéditeur et destinataire
create policy "read own transfers" on transfers for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());
create policy "create transfers" on transfers for insert to authenticated
  with check (from_user = auth.uid());
create policy "resolve transfers" on transfers for update to authenticated
  using (to_user = auth.uid());

-- backup_state: strictement personnel
create policy "own backup state" on backup_state for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
