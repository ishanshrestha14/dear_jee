-- Dear Jee — row-level security. Apply after schema.sql.
-- With RLS enabled and no matching policy, a table is invisible. That is
-- the intended default; every access path below is opt-in.

alter table profiles enable row level security;
alter table letters  enable row level security;
alter table bonds enable row level security;

-- Defense in depth: anon is stopped today only by the absence of a policy.
-- Make the deny explicit rather than emergent.
revoke all on profiles from anon;
revoke all on letters from anon;
revoke all on bonds from anon;

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

-- ---------- bonds ----------

-- You may read a bond you were part of, open or closed. That is what makes a
-- past chapter's title readable after the fact.
drop policy if exists bonds_select_member on bonds;
create policy bonds_select_member on bonds
  for select to authenticated
  using (lower_id = auth.uid() or upper_id = auth.uid());

-- There is deliberately NO insert/update/delete policy. link_partners,
-- unlink_partner, freeze_profile_letters and acknowledge_bond_end are
-- security definer and are the only writers. A client that could write bonds
-- could bond itself to a stranger.
revoke insert, update, delete on bonds from authenticated;

-- ---------- letters ----------

-- You may write only as yourself, and only to the partner you are linked to —
-- or, when you have no partner at all, to nobody, which is a held letter.
-- Without the partner condition an authenticated user could write letters
-- into any account whose id they could guess.
--
-- Held letters are restricted to the UNBONDED. Someone bonded sitting on an
-- unsent letter is a different feature and is deliberately not built.
drop policy if exists letters_insert_own_to_partner on letters;
create policy letters_insert_own_to_partner on letters
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (receiver_id = current_partner_id()
         or (receiver_id is null and current_partner_id() is null))
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
    or (receiver_id = auth.uid() and receiver_deleted_at is null
        and (scheduled_for is null or scheduled_for <= current_date))
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
              sender_deleted_at, receiver_deleted_at,
              message, salutation, body_font, scheduled_for)
  on letters to authenticated;

-- Column grants are checked BEFORE RLS. The UPDATE path has been locked down
-- since Phase 3; the INSERT path never was, so Supabase's default table grant
-- currently lets a client set is_public, share_slug or sender_archived_at at
-- insert time. This closes that, and is REQUIRED for bonds: a client that
-- could set bond_id itself would file a letter into someone else's chapter.
revoke insert on letters from authenticated;
-- salutation and body_font join the insert grant: the writer chooses both when
-- they write, and enforce_letter_update makes them immutable afterwards. The
-- grant is what allows setting them at all; the trigger is what stops them
-- changing later.
grant insert (sender_id, receiver_id, message, salutation, body_font, scheduled_for)
  on letters to authenticated;
