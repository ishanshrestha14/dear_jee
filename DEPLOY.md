# Deploying Dear Jee

Hosted on Vercel at `dearjee.vercel.app`. Supabase is the backend; there is no
server-side application code.

## First-time setup

1. **Import the repository** into Vercel. The framework preset is Vite; the
   defaults (`npm run build`, output `dist`) are correct.

2. **Set the environment variables** — Project Settings → Environment
   Variables, for the Production environment:

       VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
       VITE_SUPABASE_ANON_KEY=<the anon / public key>

   Both come from Supabase → Settings → API Keys. The anon key is public by
   design: it identifies the project, and row-level security is what protects
   the data. The `service_role` key must never go here — it bypasses RLS
   entirely.

3. **Redeploy.** This step is not optional and not obvious.

## The two things that bite

**Vite inlines `VITE_`-prefixed variables at BUILD time.** They are baked into
the JavaScript bundle when Vercel builds it. Changing one in the dashboard
does nothing until you redeploy — there is no server process to restart.

**How to tell whether it worked:** if the environment variables are missing,
the app does not error. It silently falls back to the in-memory mock and shows
every visitor three seeded letters about someone waking before an alarm. If you
see those on the live site, the variables are not set, or you have not
redeployed since setting them.

**Do NOT mark these variables "Sensitive."** Vercel offers a sensitive type
whose value is write-only. The build container never receives it — it arrives
as an empty string. Vite then inlines `""`, the minifier folds
`Boolean("" && "")` down to `false`, and `isSupabaseConfigured()` ships as a
literal `return false`. The app falls back to the mock, and the dashboard
still shows both variables as set, so nothing looks wrong. This cost a
debugging session on 2026-09-11; the live bundle had
`var Zc=``, Qc=``; function $c(){return !1}` compiled into it.

The anon key belongs in the browser bundle — every visitor's browser has it,
by design, and RLS is the protection. "Sensitive" means "must never reach the
client", which is the opposite of what this key is for. Leave both as regular
variables.

To check which type they are: `npx vercel env ls`. A `Secret` in the type
column is the broken kind; `npx vercel env pull` returning the literal
`[SENSITIVE]` confirms it.

**`vercel.json` must be present.** It rewrites every path to `index.html`.
Without it, `/letter/<slug>` and `/archive` return 404 — and a direct hit is
the only way anyone reaches a share link. This failure exists only in
production; the dev server handles it invisibly.

## In Supabase

- **Site URL** → the Vercel domain. No current flow depends on a redirect URL
  (password auth, email confirmation off), but leaving it as `localhost` is
  what breaks the first feature that does need it.
- **Close sign-ups** — Authentication → Sign In / Providers — but ONLY after
  both accounts exist. Closing them first locks out whoever has not registered
  yet, and the invite flow requires the second person to create an account
  before they can redeem a code. Check Authentication → Users and count the
  rows before flipping it.

## After deploying

Open a share link **on a phone, on a different network** — not a private window
on the same machine. That single action is the only thing that exercises the
rewrite, the build-time environment variables, the anon key, the
`get_public_letter` function and the RLS path together. Each has been verified
alone; the combination has not.
