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

delete from letters;
update profiles set partner_id = null, invite_code = new_invite_code();

-- Do NOT delete from profiles. profiles.id references auth.users on delete
-- cascade, and handle_new_user fires only on INSERT into auth.users — so a
-- deleted profile row leaves a signed-in account with no profile and no way
-- to recreate one. To start fully clean, delete the test users from
-- Supabase -> Authentication -> Users, which cascades correctly.
