# Supabase setup

Do this once, when you are ready to take Dear Jee off mock data.

## 1. Create the project

1. Go to https://supabase.com/dashboard and create a new project.
2. Choose a region near you. Save the database password somewhere safe —
   you will not need it for this app, but you cannot recover it.
3. Wait for provisioning to finish (a minute or two).

## 2. Turn OFF email confirmation

Authentication → Sign In / Providers → Email → disable "Confirm email", and save.

Without this, sign-up returns no session and the app cannot continue to the
setup screen. This is a deliberate choice for a two-person app.

## 3. Apply the SQL

SQL Editor → New query. Paste the whole of `schema.sql`, run it. Then a new
query with the whole of `policies.sql`, run that. Both are idempotent, so
re-running them is safe.

## 4. Copy the keys into .env

Project Settings → API. Copy `.env.example` to `.env` and fill in:

    VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
    VITE_SUPABASE_ANON_KEY=<the anon / public key>

The anon key is public by design — it identifies the project, and RLS is what
protects the data. Never put the `service_role` key in this repo; it bypasses
RLS entirely.

`.env` is gitignored. Restart `npm run dev` after creating it — Vite only
reads env at startup.

## 5. Verify

With `.env` absent the app runs on mock data. With it present it uses
Supabase. The console logs which adapter is active on boot.
