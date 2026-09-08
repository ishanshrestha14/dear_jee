-- Dear Jee — row-level security. Apply after schema.sql.
-- With RLS enabled and no matching policy, a table is invisible. That is
-- the intended default; every access path below is opt-in.

alter table profiles enable row level security;
alter table letters  enable row level security;

-- ---------- profiles ----------

drop policy if exists profiles_select_self_or_partner on profiles;
create policy profiles_select_self_or_partner on profiles
  for select to authenticated
  using (
    id = auth.uid()
    or id = (select p.partner_id from profiles p where p.id = auth.uid())
  );

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------- letters ----------

-- You may write only as yourself, and only to the partner you are linked to.
-- Without the second condition an authenticated user could write letters to
-- any account whose id they could guess.
drop policy if exists letters_insert_own_to_partner on letters;
create policy letters_insert_own_to_partner on letters
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and receiver_id = (select p.partner_id from profiles p where p.id = auth.uid())
  );

drop policy if exists letters_select_participant on letters;
create policy letters_select_participant on letters
  for select to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());

-- Sender may share; receiver may mark read. Column-level restriction is not
-- available in RLS, so both roles are allowed to update the row and the
-- adapter sends only the intended columns.
drop policy if exists letters_update_participant on letters;
create policy letters_update_participant on letters
  for update to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid())
  with check (sender_id = auth.uid() or receiver_id = auth.uid());
