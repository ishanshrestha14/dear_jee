-- DESTRUCTIVE. Run once, by hand, when adopting the bonds model.
--
-- Every letter in the live project on 2026-09-14 was test data, confirmed by
-- the owner, so this discards rather than backfills. That is deliberate:
-- started_at and ended_at for historical bonds are NOT recoverable from
-- letter dates, and any inferred value would be a fabrication presented as
-- history.
--
-- This file is NOT idempotent in intent — re-running it destroys real letters.
-- It is kept out of schema.sql for exactly that reason.
--
-- bonds must be cleared here too, and after letters (letters.bond_id
-- references bonds, so this order satisfies the foreign key). Leaving old
-- bonds rows behind is harmless the first time this runs, because the table
-- is freshly created and empty — but on a SECOND run every bonds row would
-- still have ended_at is null while partner_id has just gone null on every
-- profile, and the bonds_one_active_lower/upper partial unique indexes would
-- then block both people from ever bonding again, with link_partners failing
-- on the index AFTER it has already written both partner_ids.

delete from letters;
delete from bonds;
update profiles set partner_id = null, invite_code = new_invite_code();

-- Do NOT delete from profiles. profiles.id references auth.users on delete
-- cascade, and handle_new_user fires only on INSERT into auth.users — so a
-- deleted profile row leaves a signed-in account with no profile and no way
-- to recreate one. To start fully clean, delete the test users from
-- Supabase -> Authentication -> Users, which cascades correctly.
