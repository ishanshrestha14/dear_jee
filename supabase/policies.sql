-- Dear Jee — row-level security. Apply after schema.sql.
-- With RLS enabled and no matching policy, a table is invisible. That is
-- the intended default; every access path below is opt-in.

alter table profiles enable row level security;
alter table letters  enable row level security;

-- Defense in depth: anon is stopped today only by the absence of a policy.
-- Make the deny explicit rather than emergent.
revoke all on profiles from anon;
revoke all on letters from anon;

-- ---------- profiles ----------

drop policy if exists profiles_select_self_or_partner on profiles;
create policy profiles_select_self_or_partner on profiles
  for select to authenticated
  using (
    id = auth.uid()
    or id = current_partner_id()
  );

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- RLS is row-scoped, so the policy above would still let someone write their
-- own partner_id or invite_code — and setting partner_id to a stranger's uuid
-- would then satisfy the letters insert policy. Column grants are checked
-- BEFORE RLS, so this is what actually confines the write to full_name.
revoke update on profiles from authenticated;
grant update (full_name) on profiles to authenticated;

-- ---------- letters ----------

-- You may write only as yourself, and only to the partner you are linked to.
-- Without the second condition an authenticated user could write letters to
-- any account whose id they could guess.
drop policy if exists letters_insert_own_to_partner on letters;
create policy letters_insert_own_to_partner on letters
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and receiver_id = current_partner_id()
  );

-- Deleting a letter must mean you cannot read it, not merely that the app
-- stops showing it — otherwise "deleted" would leave the row fetchable
-- through the API, which is not what someone deleting a letter believes is
-- happening. Each side's deletion affects only that side.
drop policy if exists letters_select_participant on letters;
create policy letters_select_participant on letters
  for select to authenticated
  using (
    (sender_id = auth.uid() and sender_deleted_at is null)
    or (receiver_id = auth.uid() and receiver_deleted_at is null)
  );

-- Sender may share; receiver may mark read. RLS cannot restrict columns, so
-- this policy admits both participants to the row and the
-- letters_enforce_update trigger in schema.sql enforces which columns each
-- of them may actually change. The policy alone is NOT the control.
drop policy if exists letters_update_participant on letters;
create policy letters_update_participant on letters
  for update to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid())
  with check (sender_id = auth.uid() or receiver_id = auth.uid());

-- Column grants are checked BEFORE RLS, so this is what actually stops a
-- client touching sender_id, receiver_id, message or created_at at all. The
-- trigger's immutability checks are the second layer, not the first.
-- Referential actions run as the system and bypass grants, so the
-- `on delete set null` action still works.
revoke update on letters from authenticated;
grant update (is_read, is_public, share_slug,
              sender_archived_at, receiver_archived_at,
              sender_deleted_at, receiver_deleted_at)
  on letters to authenticated;
