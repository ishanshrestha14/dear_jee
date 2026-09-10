# Deploy and Polish — Design Spec

**Date:** 2026-09-10
**Status:** Awaiting review
**Builds on:** `docs/superpowers/specs/2026-09-08-dear-jee-design.md` §9 (Phase 5)
**Preceded by:** Phases 1-4, all merged to `main`

---

## 1. What this is

The last phase. It was scoped as "put Dear Jee on the internet"; it is actually
"fix a deployment that is already live and misbehaving in three specific ways."

Sharing does not really work until this is done. A share link is only a link if
someone else can open it on their own device.

### 1.1 What is live at `dearjee.vercel.app`, verified 2026-09-10

A deployment already exists. It was checked directly rather than assumed:

| Check | Result |
|---|---|
| `/` | 200 |
| `/letter/<slug>` | **404** |
| `/archive` | **404** |
| `/robots.txt` | **404** |
| A Supabase project URL in the built bundle | **absent** |
| The mock's seeded letter text in the bundle | **present** |
| `noindex` meta tag | **absent** |

Three distinct faults, each with a different cause:

**It runs on the mock.** The environment variables are not set in Vercel, so
`isSupabaseConfigured()` returns false and the deployed app falls back to the
in-memory repository. Every visitor is silently signed in as the seeded user and
shown three fabricated letters. Nothing private is exposed — those letters are
invented and Supabase was never connected, so RLS was never in play — but the
content reads as intimate, it sits under the owner's name, and the page is
indexable.

**Every deep link 404s.** There is no `vercel.json`, so `/letter/<slug>` and
`/archive` reach Vercel's static file server, match no file, and fail. This is
precisely the failure §3.1 predicts, now observed rather than anticipated.

**The build is stale.** `robots.txt` and the `noindex` meta both landed in Phase
4's final fix wave and neither is present, so the deployment predates that
merge.

### 1.2 Order of operations

The first step belongs to the owner and cannot be done from the repository:

1. **Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel, then
   redeploy.** Until this happens the live site serves fiction to strangers.
   Vite inlines `VITE_`-prefixed variables at build time, so a redeploy is
   required — restarting is not a thing that applies.
2. Add `vercel.json` (§3.1). This fixes all three 404s at once.
3. Redeploy from current `main`, which carries `noindex` and `robots.txt`.

### 1.3 The original Phase 5 list, re-derived

The founding spec named empty states, loading skeletons, error paths, a
responsive pass, reduced motion, and Vercel. Most of that landed along the way:

| Item | State |
|---|---|
| Empty states | Done — Inbox, Archive and NotFound each have a designed one |
| Error paths | Done — every route has a branch except where absence is deliberate |
| Reduced motion | Done in Phase 2, via a single `<MotionConfig reducedMotion="user">` |
| Loading states | Present as "One moment…" text |
| Loading skeletons | **Cut.** See §5 |
| Responsive pass | Structural audit only. See §4 |
| Vercel | Not started. This phase |

## 2. Decisions

| Question | Decision |
|---|---|
| Deploy now, or polish only? | Deploy. Sharing is untestable until it is live. |
| Open sign-ups on a public URL? | Close them — but only after both accounts exist. |
| The >500 kB bundle warning? | Split the public route only. |
| Loading skeletons? | Cut. |
| A responsive pass? | Structural audit here; the verdict is the owner's, on a phone. |
| CI? | No. |

**Why close sign-ups.** A stranger's account would be empty and isolated —
RLS blocks every read and they would need an invite code to link to anyone. But
an open registration form on a public URL serves nobody in a two-person app and
collects bot noise. It is one dashboard toggle and it is reversible.

**Why not CI.** A green local gate plus a Vercel build that fails on `tsc -b`
is the whole gate that matters here. A GitHub Action running the same four
commands would be ceremony.

## 3. Deployment

### 3.1 `vercel.json`

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

This single rule is why sharing works in production. Without it `/letter/<slug>`
reaches Vercel's static file server, matches no file, and returns a 404 — and a
direct hit is the ONLY way anyone ever arrives at that URL. The dev server
handles this invisibly, so the failure exists exclusively in production, on the
one path the owner cannot test alone.

Vercel checks the filesystem before applying rewrites, so `/robots.txt` and the
hashed `/assets/*` files continue to serve normally. This is stated in the guide
because "did the catch-all eat my static files?" is the obvious next question.

### 3.2 Environment

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set in the Vercel
dashboard for the Production environment. They are not committed.

**Vite inlines `VITE_`-prefixed variables at BUILD time.** Changing one in the
dashboard therefore requires a redeploy, not a restart. This surprises people
and belongs in the guide.

The anon key shipping inside the client bundle is correct and by design; RLS is
what protects the data. The `service_role` key must never appear in Vercel, in
this repository, or anywhere else in this project.

### 3.3 Supabase configuration

Set **Site URL** to the Vercel domain. No current flow depends on a redirect
URL — the app uses password auth with email confirmation off — but leaving Site
URL pointed at `localhost` is what silently breaks the first feature that does
need it, and correcting it costs one field.

Close sign-ups (Authentication → Sign In / Providers) **only after both
accounts exist**. Order matters: closing them first locks out whichever of you
has not yet registered, and the invite-link flow requires the second person to
create an account before they can redeem a code.

The accounts created during the Phase 3 go-live live in this same Supabase
project, so if both people already signed up locally, they carry over and
sign-ups can be closed immediately. Check Authentication → Users and count the
rows before flipping the toggle.

### 3.4 `DEPLOY.md`

A guide in the same voice as `supabase/README.md`: the exact click-path in
order, and the two things that bite — build-time env inlining, and closing
sign-ups after both accounts are created.

## 4. The public route is code-split

Today the app ships as one chunk. That is fine for two people who open it and
stay in it. But `/letter/:slug` is opened by **strangers, on mobile, from a
message** — and they currently download the whole application: auth, compose,
archive, the share modal, the letter modal. To read one letter, once.

```tsx
const PublicLetter = lazy(() => import('../routes/PublicLetter'))
```

wrapped in a `<Suspense>` whose fallback is the same "One moment…" line the page
already shows while fetching, so a stranger sees one waiting state rather than a
flash of one then another.

The boundary sits at the route in `App.tsx`. `PublicLetter`, `usePublicLetter`
and `PaperTexture` land in the stranger's chunk; auth, compose, archive and both
modals stay in the owner's. `formatLetterDate` is shared and will be hoisted —
correct, and not worth fighting.

**What this deliberately does not do.** The Supabase client still loads, because
`getBySlug` needs it. Splitting that out would require a second entry point and
a separate client construction path — a great deal of machinery to save perhaps
30 kB. The split is worth having and is not more thorough than that.

This is the one place in the app where bundle size is a real cost rather than a
vanity metric, and the person paying it is the one with the least reason to
wait.

## 5. What is cut, and why

**Loading skeletons.** The app shows "One moment…" in muted ink. For a product
whose entire aesthetic is restraint on paper, a shimmering grey card skeleton
would be *less* in keeping, not more. The text stays.

**A responsive pass, as a claim.** A structural audit happens: every component
read for fixed pixel widths that cannot shrink, horizontal overflow risks (long
unbroken share URLs are the obvious candidate — both `ShareModal` and
`InviteLink` render one), tap targets under 44px, and any `min-w`/`w-[…]` that
fights a 375px viewport. That is a real check and will find real things.

It is **not** a responsive pass. Nobody working on this project can see a
rendered page — not the author, not any agent. "Looks right on a phone" is a
claim none of them can make. The audit produces a list of suspects; the owner
produces the verdict, on a phone.

Scoping it this way is deliberate. This project has already had one instance of
a verification step that structurally could not prove what it claimed, which an
agent correctly refused to report as a pass.

## 6. Testing

Nothing new. This phase adds no logic, so the 42 contract cases stand
unchanged. The gates are `npm run typecheck`, `npm test`, `npm run lint`,
`npm run build`, and a successful Vercel deploy.

## 7. The one test that has never run

After deploying, open a share link **on a phone, on a different network** —
not a private window on the same machine.

That single action is the only thing that exercises the rewrite, the build-time
env vars, the anon key, the `get_public_letter` function and the RLS path
together. Every one of those has been verified alone. The combination has never
run anywhere.

## 8. Out of scope

- CI, preview-deploy workflows, a custom domain.
- Loading skeletons.
- Splitting any route other than the public one.
- Anything in `docs/superpowers/specs/2026-09-08-phase-3-carryover.md`, which
  holds five deferred items from earlier phases.
- Realtime, multiple letter fonts, link expiry, view counts.
