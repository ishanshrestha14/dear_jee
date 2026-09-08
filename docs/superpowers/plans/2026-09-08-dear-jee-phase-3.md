# Dear Jee — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-memory mock with a real Supabase backend — schema, row-level security, authentication, and invite-link partner pairing — so two people on different devices can exchange letters that persist.

**Architecture:** The repository interface built in Phase 2 is the seam. A `supabaseRepository` implements the same `LetterRepository` / `ProfileRepository` contracts, and `src/data/index.ts` picks it when `VITE_SUPABASE_URL` is set, falling back to the mock otherwise. Authentication becomes a React context that supplies the signed-in user id, replacing the module-level `currentUserId` constant. No custom server: Postgres RLS is the entire authorization layer.

**Tech Stack:** @supabase/supabase-js (already installed), React 19, React Router 7, Vite, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-dear-jee-design.md`
**Carry-over from Phases 1-2:** `docs/superpowers/specs/2026-09-08-phase-3-carryover.md`

## Global Constraints

- Never use pure white `#FFFFFF` or pure black `#000000`.
- Palette values, verbatim: `#FDFBF7`, `#F4EFE6`, `#2C2825`, `#1A1A1A` at 85%, `#C87963`, `#D4AF37`. Plus the three ratified additions: `--color-paper-edge #e8e0d2`, `--color-ink-muted #8a8078`, `--color-accent-soft #e3b3a4`.
- Three type roles only: Plus Jakarta Sans (UI), Lora (letter body), Caveat (sign-off).
- Letter view centred, max width 600px.
- All animation respects `prefers-reduced-motion` — handled by `<MotionConfig reducedMotion="user">` in `src/app/App.tsx` plus the CSS block in `src/index.css`. Do not add per-component guards.
- Components under `src/components/` must not import **values** from `src/data/`. `import type` is permitted and ratified.
- Repository methods return `{ data, error }` and NEVER throw. The Supabase client throws and returns its own error shapes — every adapter method must catch and convert.
- Never narrow a `Result` with a truthiness check. Use `=== null` / `!== null`; the empty string is a falsy `string` and will not narrow.
- Strict TypeScript. `any` is not permitted.
- Tests are logic-level only (Vitest). No component tests, no hook tests, no jsdom, no Testing Library.
- `npm run typecheck` (`tsc -b`) is the type gate. `npx tsc --noEmit` is a NO-OP in this repo — the root tsconfig is `{"files": [], "references": [...]}` — and must never be used as evidence.
- Secrets never enter git. `.env` is already in `.gitignore`; `.env.example` carries placeholder values only.

## Decisions taken before this plan

- **Supabase project does not exist yet.** Every task except Task 9 is built and verified against the mock. Task 9 is the go-live step and is the only one that needs the project.
- **Email confirmation is OFF.** Sign-up returns a session immediately; there is no "check your email" screen.
- **The anon key is public by design.** It is a client-side identifier, safe to ship in the bundle; RLS is what protects the data. Never place the `service_role` key in this repo.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/schema.sql` | Tables, indexes, the public view, the linking function |
| `supabase/policies.sql` | RLS enablement and every policy |
| `supabase/README.md` | Exact click-path for applying the SQL and configuring auth |
| `src/data/contractTests.ts` | Reusable repository contract suite, run against any implementation |
| `src/data/mockRepository.test.ts` | Runs the contract suite against the mock |
| `src/data/supabaseClient.ts` | The single configured Supabase client |
| `src/data/supabaseRepository.ts` | `LetterRepository` / `ProfileRepository` over Postgres |
| `src/data/index.ts` | Adapter selection by env; no longer exports `currentUserId` |
| `src/auth/AuthProvider.tsx` | Session, profile, sign-up / sign-in / sign-out |
| `src/auth/useAuth.ts` | Context hook |
| `src/hooks/useLetters.ts` | Takes the user id from auth rather than a constant |
| `src/routes/AuthScreen.tsx` | Sign in / sign up |
| `src/routes/SetupProfile.tsx` | First-run name entry |
| `src/routes/JoinPartner.tsx` | `/join/:inviteCode` |
| `src/components/RequireAuth.tsx` | Route guard |
| `src/components/InviteLink.tsx` | Copyable invite link for the unlinked empty state |
| `.env.example` | Placeholder env values |

---

### Task 1: Extract the reusable repository contract suite

This is deliberately first. The whole architectural bet of Phase 2 is that `supabaseRepository` satisfies the same contract as `mockRepository`. The 15 existing tests are hard-bound to the mock's constructor, so they cannot verify that. Extracting them now — before a second implementation exists — is what makes Task 4 verifiable. Written after the adapter, the extraction is worthless.

**Files:**
- Create: `src/data/contractTests.ts`
- Rewrite: `src/data/mockRepository.test.ts`

**Interfaces:**
- Consumes: `LetterRepository`, `ProfileRepository` from `src/data/types.ts`
- Produces: `describeRepositoryContract(name: string, setup: ContractSetup): void` and `type ContractSetup = () => Promise<ContractFixture>` where `ContractFixture` is `{ letters: LetterRepository; profiles: ProfileRepository; userId: string; partnerId: string; unlinked: () => Promise<ContractFixture> }`

- [ ] **Step 1: Read the existing test file**

Run: `cat src/data/mockRepository.test.ts`

Note every assertion. All 15 must survive the extraction unchanged in meaning. This task must not change what is tested — only who can run it.

- [ ] **Step 2: Write the contract suite**

Create `src/data/contractTests.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { LetterRepository, ProfileRepository } from './types'

/** Everything a contract run needs from one repository implementation. */
export interface ContractFixture {
  letters: LetterRepository
  profiles: ProfileRepository
  userId: string
  partnerId: string
  /** A second, unlinked pair, for the partner-linking cases. */
  unlinked: () => Promise<ContractFixture>
}

export type ContractSetup = () => Promise<ContractFixture>

/**
 * The behavioural contract every repository implementation must satisfy.
 *
 * Phase 2's mock and Phase 3's Supabase adapter both run this identical
 * suite, which is the only way the swap-in claim is actually verified
 * rather than assumed.
 */
export function describeRepositoryContract(name: string, setup: ContractSetup): void {
  describe(`${name} — repository contract`, () => {
    let fx: ContractFixture

    beforeEach(async () => {
      fx = await setup()
    })

    describe('listReceived', () => {
      it('returns only letters addressed to the user', async () => {
        const { data } = await fx.letters.listReceived(fx.userId)
        expect(data!.length).toBeGreaterThan(0)
        expect(data!.every((l) => l.receiverId === fx.userId)).toBe(true)
      })

      it('orders newest first', async () => {
        const { data } = await fx.letters.listReceived(fx.userId)
        const times = data!.map((l) => Date.parse(l.createdAt))
        expect([...times].sort((a, b) => b - a)).toEqual(times)
      })
    })

    describe('send', () => {
      it('stores a letter the receiver can then read', async () => {
        const sent = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Good morning, you.',
        })
        expect(sent.error).toBeNull()

        const { data } = await fx.letters.listReceived(fx.partnerId)
        expect(data!.some((l) => l.id === sent.data!.id)).toBe(true)
      })

      it('starts unread, unshared, and private', async () => {
        const { data } = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: 'Hello.',
        })
        expect(data!.isRead).toBe(false)
        expect(data!.shareSlug).toBeNull()
        expect(data!.isPublic).toBe(false)
      })

      it('rejects an empty letter without storing anything', async () => {
        const before = (await fx.letters.listReceived(fx.partnerId)).data!.length
        const result = await fx.letters.send({
          senderId: fx.userId,
          receiverId: fx.partnerId,
          message: '   ',
        })
        expect(result.data).toBeNull()
        expect(result.error).toBe('A letter needs a few words.')
        expect((await fx.letters.listReceived(fx.partnerId)).data!.length).toBe(before)
      })
    })

    describe('markRead', () => {
      it('flips isRead and persists it', async () => {
        const { data: inbox } = await fx.letters.listReceived(fx.userId)
        const target = inbox!.find((l) => !l.isRead)!
        await fx.letters.markRead(target.id)
        const { data: after } = await fx.letters.listReceived(fx.userId)
        expect(after!.find((l) => l.id === target.id)!.isRead).toBe(true)
      })

      it('reports a missing letter rather than throwing', async () => {
        const result = await fx.letters.markRead('00000000-0000-4000-8000-000000000000')
        expect(result.data).toBeNull()
        expect(result.error).toBe('Letter not found.')
      })
    })

    describe('share', () => {
      it('makes the letter public and assigns a slug', async () => {
        const { data: inbox } = await fx.letters.listReceived(fx.userId)
        const { data } = await fx.letters.share(inbox![0].id)
        expect(data!.isPublic).toBe(true)
        expect(data!.shareSlug).toHaveLength(12)
      })

      it('reuses the slug on a second share so old links keep working', async () => {
        const { data: inbox } = await fx.letters.listReceived(fx.userId)
        const first = await fx.letters.share(inbox![0].id)
        const second = await fx.letters.share(inbox![0].id)
        expect(second.data!.shareSlug).toBe(first.data!.shareSlug)
      })
    })

    describe('getBySlug', () => {
      it('returns only the publicly safe fields', async () => {
        const { data: inbox } = await fx.letters.listReceived(fx.userId)
        const shared = await fx.letters.share(inbox![0].id)
        const { data } = await fx.letters.getBySlug(shared.data!.shareSlug!)
        expect(Object.keys(data!).sort()).toEqual([
          'createdAt',
          'message',
          'receiverName',
          'senderName',
        ])
      })

      it('refuses an unknown slug', async () => {
        const result = await fx.letters.getBySlug('nosuchslug12')
        expect(result.data).toBeNull()
        expect(result.error).toBe('This letter is not available.')
      })
    })

    describe('linkPartner', () => {
      it('links both profiles to each other', async () => {
        const u = await fx.unlinked()
        const partner = await u.profiles.getById(u.partnerId)
        const linked = await u.profiles.linkPartner(u.userId, partner.data!.inviteCode)
        expect(linked.data!.partnerId).toBe(u.partnerId)
        const other = await u.profiles.getById(u.partnerId)
        expect(other.data!.partnerId).toBe(u.userId)
      })

      it('refuses an unknown invite code', async () => {
        const u = await fx.unlinked()
        const result = await u.profiles.linkPartner(u.userId, 'BADCODE')
        expect(result.data).toBeNull()
        expect(result.error).toBe('That invite link is not valid.')
      })

      it('refuses to link someone who already has a partner', async () => {
        const partner = await fx.profiles.getById(fx.partnerId)
        const result = await fx.profiles.linkPartner(fx.userId, partner.data!.inviteCode)
        expect(result.data).toBeNull()
        expect(result.error).toBe('You are already connected.')
      })

      it('refuses to link a profile to itself', async () => {
        const u = await fx.unlinked()
        const self = await u.profiles.getById(u.userId)
        const result = await u.profiles.linkPartner(u.userId, self.data!.inviteCode)
        expect(result.data).toBeNull()
        expect(result.error).toBe('That invite link is your own.')
      })
    })
  })
}
```

Note the one deliberate change: `markRead`'s missing-letter case now uses a UUID-shaped string rather than `'does-not-exist'`. Postgres rejects a malformed uuid with a type error rather than "not found", so a non-uuid string would make this case fail against Supabase for the wrong reason.

- [ ] **Step 3: Rewrite the mock's test file to call the suite**

Replace the entire contents of `src/data/mockRepository.test.ts`:

```ts
import { createMockRepositories, MOCK_USER_ID, MOCK_PARTNER_ID } from './mockRepository'
import { describeRepositoryContract, type ContractFixture } from './contractTests'

function fixture(options: { unlinked?: boolean } = {}): ContractFixture {
  const repos = createMockRepositories(options)
  return {
    letters: repos.letters,
    profiles: repos.profiles,
    userId: MOCK_USER_ID,
    partnerId: MOCK_PARTNER_ID,
    unlinked: async () => fixture({ unlinked: true }),
  }
}

describeRepositoryContract('mockRepository', async () => fixture())
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS, 28 tests total across 4 files. The count is unchanged because the same 15 contract cases now run through the shared suite.

- [ ] **Step 5: Type-check and commit**

```bash
npm run typecheck && npm run lint
git add src/data/contractTests.ts src/data/mockRepository.test.ts
git commit -m "refactor: extract reusable repository contract suite"
```

---

### Task 2: Database schema, security policies, and setup guide

Nothing here runs yet — the Supabase project does not exist. These files are applied in Task 9. They are written first because the adapter in Task 4 must match them exactly.

**Files:**
- Create: `supabase/schema.sql`, `supabase/policies.sql`, `supabase/README.md`

**Interfaces:**
- Consumes: the data model in spec §4
- Produces: tables `profiles` and `letters`, view `public_letters`, functions `link_partners(invite_code text)` and `handle_new_user()`

- [ ] **Step 1: Write the schema**

Create `supabase/schema.sql`:

```sql
-- Dear Jee — schema. Apply this first, then policies.sql.

create extension if not exists pgcrypto;

create table if not exists profiles (
  id          uuid primary key references auth.users on delete cascade,
  full_name   text        not null default '',
  partner_id  uuid        references profiles(id) on delete set null,
  invite_code text        not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists letters (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid        not null references profiles(id) on delete cascade,
  receiver_id uuid        not null references profiles(id) on delete cascade,
  -- The mock enforced this in the repository. The Supabase adapter cannot,
  -- and RLS does not inspect content, so the guarantee lives here instead.
  message     text        not null check (char_length(message) between 1 and 5000),
  created_at  timestamptz not null default now(),
  is_read     boolean     not null default false,
  share_slug  text        unique,
  is_public   boolean     not null default false
);

create index if not exists letters_receiver_created_idx
  on letters (receiver_id, created_at desc);

create index if not exists letters_share_slug_idx
  on letters (share_slug) where share_slug is not null;

-- A new auth user gets a profile automatically, with a random invite code.
-- Base58-ish: no 0, O, I or l, so a code read off a screen is unambiguous.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  code text;
begin
  loop
    code := array_to_string(array(
      select substr('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
                    (floor(random() * 58) + 1)::int, 1)
      from generate_series(1, 8)
    ), '');
    exit when not exists (select 1 from profiles where invite_code = code);
  end loop;

  insert into profiles (id, full_name, invite_code)
  values (new.id, '', code);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Links two profiles in ONE transaction. A half-applied link would leave
-- one person able to write to someone who cannot write back.
create or replace function link_partners(code text)
returns profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  me    profiles;
  other profiles;
begin
  select * into me from profiles where id = auth.uid();
  if me is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  if me.partner_id is not null then
    raise exception 'ALREADY_LINKED';
  end if;

  select * into other from profiles where invite_code = code;
  if other is null then
    raise exception 'INVALID_CODE';
  end if;
  if other.id = me.id then
    raise exception 'OWN_CODE';
  end if;
  if other.partner_id is not null then
    raise exception 'ALREADY_LINKED';
  end if;

  update profiles set partner_id = other.id where id = me.id;
  update profiles set partner_id = me.id   where id = other.id;

  select * into me from profiles where id = me.id;
  return me;
end;
$$;

-- The anonymous reader's view of a shared letter. Exactly four columns:
-- ids and emails must be unreachable from an unauthenticated session.
create or replace view public_letters
with (security_invoker = true)
as
  select
    l.share_slug           as share_slug,
    l.message              as message,
    l.created_at           as created_at,
    sender.full_name       as sender_name,
    receiver.full_name     as receiver_name
  from letters l
  join profiles sender   on sender.id   = l.sender_id
  join profiles receiver on receiver.id = l.receiver_id
  where l.is_public = true and l.share_slug is not null;

grant select on public_letters to anon, authenticated;
```

- [ ] **Step 2: Write the policies**

Create `supabase/policies.sql`:

```sql
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
```

- [ ] **Step 3: Write the setup guide**

Create `supabase/README.md`:

```markdown
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
```

- [ ] **Step 4: Commit**

```bash
git add supabase/
git commit -m "feat: add Supabase schema, RLS policies, and setup guide"
```

---

### Task 3: Supabase client and environment plumbing

**Files:**
- Create: `src/data/supabaseClient.ts`, `.env.example`
- Modify: `src/vite-env.d.ts`

**Interfaces:**
- Consumes: `@supabase/supabase-js` (already a dependency)
- Produces: `supabase` (the client, or `null` when unconfigured) and `isSupabaseConfigured(): boolean`

- [ ] **Step 1: Write the env example**

Create `.env.example`:

```
# Copy to .env and fill in from Supabase → Project Settings → API.
# The anon key is public by design; RLS protects the data.
# Never put the service_role key here.
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

- [ ] **Step 2: Declare the env types**

Replace the contents of `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

- [ ] **Step 3: Write the client**

Create `src/data/supabaseClient.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * True when both env values are present. When false the app runs on the
 * in-memory mock, which is the intended state until the project exists.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey)
}

/**
 * The single client for the app. Null when unconfigured — callers must
 * check `isSupabaseConfigured()` first rather than assuming a client.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null
```

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck && npm run build && npm test
git add .env.example src/vite-env.d.ts src/data/supabaseClient.ts
git commit -m "feat: add Supabase client and env plumbing"
```

Expected: typecheck clean, build succeeds, 28 tests pass. `.env` must NOT appear in `git status` — if it does, stop and fix `.gitignore`.

---

### Task 4: The Supabase repository adapter

**Files:**
- Create: `src/data/supabaseRepository.ts`
- Modify: `src/data/index.ts`

**Interfaces:**
- Consumes: `supabase`, `isSupabaseConfigured` from Task 3; `Letter`, `Profile`, `PublicLetter`, `Result`, `LetterRepository`, `ProfileRepository`, `SendLetterInput` from `./types`; `generateSlug` from `../lib/slug`; `validateLetter` from `../lib/validation`
- Produces: `createSupabaseRepositories(): { letters: LetterRepository; profiles: ProfileRepository }`

- [ ] **Step 1: Write the adapter**

Create `src/data/supabaseRepository.ts`:

```ts
import { supabase } from './supabaseClient'
import { generateSlug } from '../lib/slug'
import { validateLetter } from '../lib/validation'
import type {
  Letter,
  LetterRepository,
  Profile,
  ProfileRepository,
  PublicLetter,
  Result,
  SendLetterInput,
} from './types'

const ok = <T>(data: T): Result<T> => ({ data, error: null })
const fail = <T>(error: string): Result<T> => ({ data: null, error })

/** Postgres rows are snake_case; the domain is camelCase. */
interface LetterRow {
  id: string
  sender_id: string
  receiver_id: string
  message: string
  created_at: string
  is_read: boolean
  share_slug: string | null
  is_public: boolean
}

interface ProfileRow {
  id: string
  full_name: string
  partner_id: string | null
  invite_code: string
  created_at: string
}

const toLetter = (r: LetterRow): Letter => ({
  id: r.id,
  senderId: r.sender_id,
  receiverId: r.receiver_id,
  message: r.message,
  createdAt: r.created_at,
  isRead: r.is_read,
  shareSlug: r.share_slug,
  isPublic: r.is_public,
})

const toProfile = (r: ProfileRow): Profile => ({
  id: r.id,
  fullName: r.full_name,
  partnerId: r.partner_id,
  inviteCode: r.invite_code,
  createdAt: r.created_at,
})

/**
 * Maps the errors `link_partners` raises to the exact user-facing copy the
 * contract asserts. Postgres wraps the raised message, so match on substring.
 */
function linkErrorMessage(raw: string): string {
  if (raw.includes('ALREADY_LINKED')) return 'You are already connected.'
  if (raw.includes('OWN_CODE')) return 'That invite link is your own.'
  if (raw.includes('INVALID_CODE')) return 'That invite link is not valid.'
  if (raw.includes('PROFILE_NOT_FOUND')) return 'Profile not found.'
  return 'That invite link could not be used.'
}

/** The client is guaranteed non-null here; index.ts only calls this when configured. */
export function createSupabaseRepositories(): {
  letters: LetterRepository
  profiles: ProfileRepository
} {
  if (supabase === null) {
    throw new Error('createSupabaseRepositories called without configuration')
  }
  const db = supabase

  const letterRepository: LetterRepository = {
    async listReceived(userId) {
      const { data, error } = await db
        .from('letters')
        .select('*')
        .eq('receiver_id', userId)
        .order('created_at', { ascending: false })
      if (error) return fail(error.message)
      return ok((data as LetterRow[]).map(toLetter))
    },

    async send({ senderId, receiverId, message }: SendLetterInput) {
      // Validate before the round trip. The DB CHECK is the backstop, but
      // this is what produces the exact user-facing copy.
      const validation = validateLetter(message)
      if (!validation.ok) return fail(validation.reason)

      const { data, error } = await db
        .from('letters')
        .insert({ sender_id: senderId, receiver_id: receiverId, message: message.trim() })
        .select()
        .single()
      if (error) return fail(error.message)
      return ok(toLetter(data as LetterRow))
    },

    async markRead(letterId) {
      const { data, error } = await db
        .from('letters')
        .update({ is_read: true })
        .eq('id', letterId)
        .select()
        .maybeSingle()
      if (error) return fail(error.message)
      if (data === null) return fail('Letter not found.')
      return ok(toLetter(data as LetterRow))
    },

    async share(letterId) {
      const existing = await db
        .from('letters')
        .select('*')
        .eq('id', letterId)
        .maybeSingle()
      if (existing.error) return fail(existing.error.message)
      if (existing.data === null) return fail('Letter not found.')

      const row = existing.data as LetterRow
      // Reuse the slug so links already sent keep resolving.
      const slug = row.share_slug ?? generateSlug()

      const { data, error } = await db
        .from('letters')
        .update({ is_public: true, share_slug: slug })
        .eq('id', letterId)
        .select()
        .single()
      if (error) return fail(error.message)
      return ok(toLetter(data as LetterRow))
    },

    async getBySlug(slug) {
      // Reads the restricted view, not the table: an anonymous session must
      // never be able to reach ids or emails.
      const { data, error } = await db
        .from('public_letters')
        .select('message, created_at, sender_name, receiver_name')
        .eq('share_slug', slug)
        .maybeSingle()
      if (error) return fail(error.message)
      if (data === null) return fail('This letter is not available.')

      const view: PublicLetter = {
        message: data.message as string,
        createdAt: data.created_at as string,
        senderName: (data.sender_name as string) || 'Someone',
        receiverName: (data.receiver_name as string) || 'you',
      }
      return ok(view)
    },
  }

  const profileRepository: ProfileRepository = {
    async getById(id) {
      const { data, error } = await db
        .from('profiles')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) return fail(error.message)
      if (data === null) return fail('Profile not found.')
      return ok(toProfile(data as ProfileRow))
    },

    async getByInviteCode(inviteCode) {
      const { data, error } = await db
        .from('profiles')
        .select('*')
        .eq('invite_code', inviteCode)
        .maybeSingle()
      if (error) return fail(error.message)
      if (data === null) return fail('That invite link is not valid.')
      return ok(toProfile(data as ProfileRow))
    },

    async linkPartner(_userId, inviteCode) {
      // One transaction in the database: the link must not half-apply.
      // _userId is unused because the function reads auth.uid() server-side,
      // which is also what stops a client linking somebody else's account.
      const { data, error } = await db.rpc('link_partners', { code: inviteCode })
      if (error) return fail(linkErrorMessage(error.message))
      if (data === null) return fail('That invite link could not be used.')
      return ok(toProfile(data as ProfileRow))
    },
  }

  return { letters: letterRepository, profiles: profileRepository }
}
```

- [ ] **Step 2: Wire adapter selection**

Replace the contents of `src/data/index.ts`:

```ts
import { createMockRepositories } from './mockRepository'
import { createSupabaseRepositories } from './supabaseRepository'
import { isSupabaseConfigured } from './supabaseClient'

/**
 * The single swap point between mock and real data.
 *
 * With no .env the app runs on the in-memory mock, which is how it is
 * developed and how the test suite runs. With VITE_SUPABASE_URL and
 * VITE_SUPABASE_ANON_KEY present it talks to Postgres. Nothing above this
 * module knows which is active.
 */
const repositories = isSupabaseConfigured()
  ? createSupabaseRepositories()
  : createMockRepositories()

export const letterRepository = repositories.letters
export const profileRepository = repositories.profiles

/** Which adapter is live. */
export const usingSupabase = isSupabaseConfigured()

// Surfaced at boot so "which backend am I talking to?" is never a guess.
// Dev only — this must not appear in a production console.
if (import.meta.env.DEV) {
  console.info(`[dear-jee] data source: ${usingSupabase ? 'supabase' : 'mock'}`)
}

export type { Letter, Profile, PublicLetter, Result } from './types'
```

Note `currentUserId` is deliberately gone. Task 5 replaces it with the authenticated user's id; anything still importing it will now fail to compile, which is how you find every call site.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: FAIL — `src/hooks/useLetters.ts` still imports `currentUserId`. This is the expected intermediate state; Task 5 fixes it.

Run: `npm test`
Expected: PASS, 28 tests. The mock path is unchanged and the adapter has no test yet — it gets one in Task 9, when a real database exists to run it against.

- [ ] **Step 4: Commit**

```bash
git add src/data/supabaseRepository.ts src/data/index.ts
git commit -m "feat: add Supabase repository adapter and env-based selection"
```

Committing with a failing typecheck is deliberate here and is the only place in this plan it happens: the break is the mechanism that locates every `currentUserId` consumer, and Task 5 closes it.

---

### Task 5: Auth context, and moving partner resolution out of useLetters

This task closes the typecheck break from Task 4 and fixes two problems the Phase 2 final review identified: `Inbox` and `Compose` each mounted their own `useLetters`, resolving the partner twice, and `useLetters`' effect had `[]` deps so it could never re-run for a different user.

**Files:**
- Create: `src/auth/AuthProvider.tsx`, `src/auth/useAuth.ts`
- Modify: `src/hooks/useLetters.ts`

**Interfaces:**
- Consumes: `supabase`, `isSupabaseConfigured` from `../data/supabaseClient`; `profileRepository` from `../data`; `Profile` from `../data/types`
- Produces: `<AuthProvider>` and `useAuth(): AuthState` where

```ts
interface AuthState {
  userId: string | null
  profile: Profile | null
  partnerName: string
  loading: boolean
  error: string | null
  signUp(email: string, password: string): Promise<{ ok: boolean; error?: string }>
  signIn(email: string, password: string): Promise<{ ok: boolean; error?: string }>
  signOut(): Promise<void>
  refreshProfile(): Promise<void>
}
```

- [ ] **Step 1: Write the context hook**

Create `src/auth/useAuth.ts`:

```ts
import { createContext, useContext } from 'react'
import type { Profile } from '../data/types'

export interface AuthState {
  userId: string | null
  profile: Profile | null
  partnerName: string
  loading: boolean
  error: string | null
  signUp(email: string, password: string): Promise<{ ok: boolean; error?: string }>
  signIn(email: string, password: string): Promise<{ ok: boolean; error?: string }>
  signOut(): Promise<void>
  refreshProfile(): Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

/** Throws outside the provider — a missing provider is a wiring bug, not a state. */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (ctx === null) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
```

- [ ] **Step 2: Write the provider**

Create `src/auth/AuthProvider.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase, isSupabaseConfigured } from '../data/supabaseClient'
import { profileRepository } from '../data'
import { MOCK_USER_ID } from '../data/mockRepository'
import type { Profile } from '../data/types'
import { AuthContext, type AuthState } from './useAuth'

/**
 * Owns the session and the profile, including the partner's name.
 *
 * Partner resolution lives here rather than in useLetters so that Inbox and
 * Compose share one load instead of each mounting their own and racing.
 *
 * With no Supabase configuration the provider signs in as the mock user
 * immediately, so the app remains fully usable on mock data.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [partnerName, setPartnerName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /** Loads the profile and, when linked, the partner's display name. */
  const loadProfile = useCallback(async (id: string) => {
    const me = await profileRepository.getById(id)
    if (me.error !== null) {
      setError(me.error)
      setProfile(null)
      return
    }
    setProfile(me.data)
    setError(null)

    if (me.data.partnerId === null) {
      setPartnerName('')
      return
    }
    const partner = await profileRepository.getById(me.data.partnerId)
    setPartnerName(partner.error !== null ? '' : partner.data.fullName)
  }, [])

  useEffect(() => {
    let cancelled = false

    // Mock mode: no session to fetch, sign straight in as the seeded user.
    if (!isSupabaseConfigured() || supabase === null) {
      void (async () => {
        await loadProfile(MOCK_USER_ID)
        if (cancelled) return
        setUserId(MOCK_USER_ID)
        setLoading(false)
      })()
      return () => {
        cancelled = true
      }
    }

    const db = supabase

    void (async () => {
      const { data } = await db.auth.getSession()
      if (cancelled) return
      const id = data.session?.user.id ?? null
      if (id !== null) await loadProfile(id)
      if (cancelled) return
      setUserId(id)
      setLoading(false)
    })()

    // Keeps every tab in step, and handles token refresh and sign-out.
    const { data: sub } = db.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id ?? null
      setUserId(id)
      if (id === null) {
        setProfile(null)
        setPartnerName('')
      } else {
        void loadProfile(id)
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signUp = useCallback<AuthState['signUp']>(async (email, password) => {
    if (supabase === null) return { ok: false, error: 'Supabase is not configured.' }
    const { data, error: err } = await supabase.auth.signUp({ email, password })
    if (err) return { ok: false, error: err.message }
    // Email confirmation is off, so a session is expected here. If one is
    // missing, confirmation is still enabled in the dashboard.
    if (data.session === null) {
      return { ok: false, error: 'Check your email to confirm your account, then sign in.' }
    }
    return { ok: true }
  }, [])

  const signIn = useCallback<AuthState['signIn']>(async (email, password) => {
    if (supabase === null) return { ok: false, error: 'Supabase is not configured.' }
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) return { ok: false, error: err.message }
    return { ok: true }
  }, [])

  const signOut = useCallback<AuthState['signOut']>(async () => {
    if (supabase === null) return
    await supabase.auth.signOut()
  }, [])

  const refreshProfile = useCallback<AuthState['refreshProfile']>(async () => {
    if (userId !== null) await loadProfile(userId)
  }, [userId, loadProfile])

  const value = useMemo<AuthState>(
    () => ({
      userId,
      profile,
      partnerName,
      loading,
      error,
      signUp,
      signIn,
      signOut,
      refreshProfile,
    }),
    [userId, profile, partnerName, loading, error, signUp, signIn, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
```

- [ ] **Step 3: Rewrite useLetters to take its ids from auth**

Replace the contents of `src/hooks/useLetters.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { letterRepository } from '../data'
import { useAuth } from '../auth/useAuth'
import type { Letter } from '../data/types'

interface UseLetters {
  letters: Letter[]
  partnerName: string
  loading: boolean
  error: string | null
  sendLetter(message: string): Promise<{ ok: boolean; error?: string }>
  markRead(id: string): Promise<void>
}

/**
 * The inbox. Identity and partner resolution belong to AuthProvider; this
 * hook only owns letters, and reloads whenever the signed-in user changes.
 */
export function useLetters(): UseLetters {
  const { userId, profile, partnerName, loading: authLoading } = useAuth()
  const partnerId = profile?.partnerId ?? null

  const [letters, setLetters] = useState<Letter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (userId === null) {
      setLetters([])
      setLoading(authLoading)
      return
    }

    let cancelled = false
    setLoading(true)

    void (async () => {
      const inbox = await letterRepository.listReceived(userId)
      if (cancelled) return
      if (inbox.error !== null) setError(inbox.error)
      else {
        setLetters(inbox.data)
        setError(null)
      }
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [userId, authLoading])

  const sendLetter = useCallback<UseLetters['sendLetter']>(
    async (message) => {
      if (userId === null) return { ok: false, error: 'You are not signed in.' }
      if (partnerId === null) return { ok: false, error: 'You are not connected to anyone yet.' }
      const result = await letterRepository.send({
        senderId: userId,
        receiverId: partnerId,
        message,
      })
      if (result.error !== null) return { ok: false, error: result.error }
      return { ok: true }
    },
    [userId, partnerId],
  )

  const markRead = useCallback<UseLetters['markRead']>(async (id) => {
    // Optimistic: the dot disappears the instant the letter opens.
    setLetters((current) => current.map((l) => (l.id === id ? { ...l, isRead: true } : l)))
    const result = await letterRepository.markRead(id)
    if (result.error !== null) {
      // Roll back: the server never confirmed the read, so the dot returns.
      setLetters((current) => current.map((l) => (l.id === id ? { ...l, isRead: false } : l)))
    }
  }, [])

  return {
    letters,
    partnerName,
    loading: loading || authLoading,
    error,
    sendLetter,
    markRead,
  }
}
```

- [ ] **Step 4: Verify the typecheck break is closed**

Run: `npm run typecheck`
Expected: clean. If it still fails, something else imported `currentUserId` — fix that call site the same way, by taking the id from `useAuth()`.

Run: `npm test`
Expected: 28 passing.

Note the app will not render correctly until Task 6 mounts `<AuthProvider>`; `useAuth` throws outside it. That is intended — the throw is what makes a missing provider obvious rather than silent.

- [ ] **Step 5: Commit**

```bash
git add src/auth/ src/hooks/useLetters.ts
git commit -m "feat: add auth context and move partner resolution out of useLetters"
```

---

### Task 6: Sign in / sign up, the route guard, and sign-out

**Files:**
- Create: `src/routes/AuthScreen.tsx`, `src/components/RequireAuth.tsx`
- Modify: `src/app/App.tsx`, `src/components/Layout.tsx`

**Interfaces:**
- Consumes: `useAuth` from `../auth/useAuth`; `PaperTexture` from `../design/PaperTexture`
- Produces: default-exported `AuthScreen`, and `<RequireAuth>{children}</RequireAuth>`

- [ ] **Step 1: Write the route guard**

Create `src/components/RequireAuth.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

/**
 * Gates the authenticated routes. Also pushes a signed-in user who has not
 * named themselves to /setup, so the app never renders "Dear ," to anyone.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { userId, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <p className="py-20 text-center font-ui text-sm text-ink-muted">One moment…</p>
  }

  if (userId === null) {
    // Remember where they were headed so /join/:code survives a sign-in.
    return <Navigate to="/auth" state={{ from: location.pathname }} replace />
  }

  const needsSetup = profile !== null && profile.fullName.trim() === ''
  if (needsSetup && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />
  }

  return <>{children}</>
}
```

- [ ] **Step 2: Write the auth screen**

Create `src/routes/AuthScreen.tsx`:

```tsx
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { PaperTexture } from '../design/PaperTexture'
import { useAuth } from '../auth/useAuth'

type Mode = 'signIn' | 'signUp'

interface LocationState {
  from?: string
}

export default function AuthScreen() {
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as LocationState | null)?.from ?? '/'

  const [mode, setMode] = useState<Mode>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result = mode === 'signIn' ? await signIn(email, password) : await signUp(email, password)
    setBusy(false)
    if (result.ok) navigate(from, { replace: true })
    else setError(result.error ?? 'That did not work.')
  }

  return (
    <div className="mx-auto max-w-[420px] pt-10">
      <PaperTexture className="p-8 sm:p-10">
        <h1 className="font-hand text-4xl text-ink-ui">Dear Jee</h1>
        <p className="mt-2 font-letter text-ink-letter">
          {mode === 'signIn' ? 'Welcome back.' : 'Letters, for the two of you.'}
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="email" className="font-ui text-xs text-ink-muted">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-letter border border-paper-edge bg-paper-app px-3 py-2 font-ui text-sm text-ink-ui focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="password" className="font-ui text-xs text-ink-muted">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-letter border border-paper-edge bg-paper-app px-3 py-2 font-ui text-sm text-ink-ui focus:border-accent focus:outline-none"
            />
          </div>

          {error && (
            <p role="alert" className="font-ui text-sm text-accent">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-accent px-6 py-2.5 font-ui text-sm font-medium text-paper-app transition-shadow hover:shadow-letter-lifted disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'One moment…' : mode === 'signIn' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signIn' ? 'signUp' : 'signIn')
            setError(null)
          }}
          className="mt-6 font-ui text-xs text-ink-muted underline underline-offset-4 hover:text-accent"
        >
          {mode === 'signIn' ? 'Need an account?' : 'Already have an account?'}
        </button>
      </PaperTexture>
    </div>
  )
}
```

- [ ] **Step 3: Add sign-out to the header**

In `src/components/Layout.tsx`, add the import:

```tsx
import { useAuth } from '../auth/useAuth'
```

Inside the `Layout` function, before the `return`, add:

```tsx
  const { userId, signOut } = useAuth()
```

Then replace the single "Write a letter" link with this group, keeping the surrounding `<header>` exactly as it is:

```tsx
        {userId !== null && (
          <nav className="flex items-center gap-5">
            <Link
              to="/compose"
              className="font-ui text-sm font-medium text-ink-muted transition-colors hover:text-accent"
            >
              Write a letter
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="font-ui text-sm text-ink-muted transition-colors hover:text-accent"
            >
              Sign out
            </button>
          </nav>
        )}
```

- [ ] **Step 4: Mount the provider and the routes**

Replace the contents of `src/app/App.tsx`:

```tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { AuthProvider } from '../auth/AuthProvider'
import { RequireAuth } from '../components/RequireAuth'
import { Layout } from '../components/Layout'
import Inbox from '../routes/Inbox'
import Compose from '../routes/Compose'
import AuthScreen from '../routes/AuthScreen'

export default function App() {
  return (
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <AuthProvider>
          <Layout>
            <Routes>
              <Route path="/auth" element={<AuthScreen />} />
              <Route
                path="/"
                element={
                  <RequireAuth>
                    <Inbox />
                  </RequireAuth>
                }
              />
              <Route
                path="/compose"
                element={
                  <RequireAuth>
                    <Compose />
                  </RequireAuth>
                }
              />
            </Routes>
          </Layout>
        </AuthProvider>
      </MotionConfig>
    </BrowserRouter>
  )
}
```

`/setup` and `/join/:inviteCode` are added in Tasks 7 and 8.

- [ ] **Step 5: Verify**

```bash
npm run typecheck && npm test && npm run build && npm run lint
```

Expected: all clean, 28 tests passing.

Start the dev server and fetch `/` and `/auth`; both must return HTTP 200. With no `.env` the app is in mock mode, so `/` renders the inbox directly — the mock user is signed in automatically and never sees `/auth`. That is correct.

- [ ] **Step 6: Commit**

```bash
git add src/routes/AuthScreen.tsx src/components/RequireAuth.tsx src/app/App.tsx src/components/Layout.tsx
git commit -m "feat: add auth screen, route guard, and sign-out"
```

---

### Task 7: First-run profile setup

**Files:**
- Create: `src/routes/SetupProfile.tsx`
- Modify: `src/app/App.tsx`, `src/data/supabaseRepository.ts`, `src/data/mockRepository.ts`, `src/data/types.ts`

**Interfaces:**
- Consumes: `useAuth`, `profileRepository`
- Produces: default-exported `SetupProfile`, and a new repository method `updateName(userId: string, fullName: string): Promise<Result<Profile>>` on `ProfileRepository`

- [ ] **Step 1: Add updateName to the contract**

In `src/data/types.ts`, add to the `ProfileRepository` interface, after `getByInviteCode`:

```ts
  updateName(userId: string, fullName: string): Promise<Result<Profile>>
```

- [ ] **Step 2: Implement it on the mock**

In `src/data/mockRepository.ts`, inside `profileRepository`, add after `getByInviteCode`:

```ts
    async updateName(userId, fullName) {
      const profile = findProfile(userId)
      if (!profile) return fail('Profile not found.')
      const trimmed = fullName.trim()
      if (trimmed.length === 0) return fail('Please enter a name.')
      profile.fullName = trimmed
      return ok({ ...profile })
    },
```

- [ ] **Step 3: Implement it on the Supabase adapter**

In `src/data/supabaseRepository.ts`, inside `profileRepository`, add after `getByInviteCode`:

```ts
    async updateName(userId, fullName) {
      const trimmed = fullName.trim()
      if (trimmed.length === 0) return fail('Please enter a name.')
      const { data, error } = await db
        .from('profiles')
        .update({ full_name: trimmed })
        .eq('id', userId)
        .select()
        .maybeSingle()
      if (error) return fail(error.message)
      if (data === null) return fail('Profile not found.')
      return ok(toProfile(data as ProfileRow))
    },
```

- [ ] **Step 4: Write the setup screen**

Create `src/routes/SetupProfile.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PaperTexture } from '../design/PaperTexture'
import { useAuth } from '../auth/useAuth'
import { profileRepository } from '../data'

export default function SetupProfile() {
  const { userId, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (userId === null) return
    setBusy(true)
    setError(null)
    const result = await profileRepository.updateName(userId, name)
    if (result.error !== null) {
      setBusy(false)
      setError(result.error)
      return
    }
    await refreshProfile()
    setBusy(false)
    navigate('/', { replace: true })
  }

  return (
    <div className="mx-auto max-w-[420px] pt-10">
      <PaperTexture className="p-8 sm:p-10">
        <h1 className="font-hand text-4xl text-ink-ui">What should they call you?</h1>
        <p className="mt-2 font-letter text-ink-letter">
          This is the name signed at the bottom of every letter you write.
        </p>

        <form onSubmit={handleSubmit} className="mt-8">
          <label htmlFor="name" className="font-ui text-xs text-ink-muted">
            Your name
          </label>
          <input
            id="name"
            type="text"
            required
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (error) setError(null)
            }}
            className="mt-1 w-full rounded-letter border border-paper-edge bg-paper-app px-3 py-2 font-ui text-sm text-ink-ui focus:border-accent focus:outline-none"
          />

          {error && (
            <p role="alert" className="mt-3 font-ui text-sm text-accent">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || name.trim().length === 0}
            className="mt-6 w-full rounded-full bg-accent px-6 py-2.5 font-ui text-sm font-medium text-paper-app transition-shadow hover:shadow-letter-lifted disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'One moment…' : 'Continue'}
          </button>
        </form>
      </PaperTexture>
    </div>
  )
}
```

- [ ] **Step 5: Register the route**

In `src/app/App.tsx`, add the import:

```tsx
import SetupProfile from '../routes/SetupProfile'
```

and add inside `<Routes>`, after the `/auth` route:

```tsx
              <Route
                path="/setup"
                element={
                  <RequireAuth>
                    <SetupProfile />
                  </RequireAuth>
                }
              />
```

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck && npm test && npm run build && npm run lint
git add src/routes/SetupProfile.tsx src/app/App.tsx src/data/
git commit -m "feat: add first-run profile setup"
```

Expected: 28 tests still passing. `updateName` is not in the contract suite because the suite's 15 cases are the Phase 2 contract; adding it there would change what Task 1 extracted. It is exercised manually in Task 9.

---

### Task 8: Invite link and partner joining

**Files:**
- Create: `src/routes/JoinPartner.tsx`, `src/components/InviteLink.tsx`
- Modify: `src/app/App.tsx`, `src/routes/Inbox.tsx`

**Interfaces:**
- Consumes: `useAuth`, `profileRepository`, `PaperTexture`
- Produces: default-exported `JoinPartner`, and `<InviteLink inviteCode={string} />`

- [ ] **Step 1: Write the invite link component**

Create `src/components/InviteLink.tsx`:

```tsx
import { useState } from 'react'
import { Check, Link as LinkIcon } from 'lucide-react'

/**
 * The unlinked empty state's main action: a copyable /join/<code> URL to
 * send to your partner in whatever app you already text in.
 */
export function InviteLink({ inviteCode }: { inviteCode: string }) {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/join/${inviteCode}`

  async function copy() {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Dear Jee', url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // The user dismissed the share sheet, or the clipboard was refused.
      // Nothing to recover from; the URL is on screen to copy by hand.
    }
  }

  return (
    <div className="mx-auto mt-8 max-w-sm">
      <p className="break-all rounded-letter border border-paper-edge bg-paper-app px-3 py-2 font-ui text-xs text-ink-muted">
        {url}
      </p>
      <button
        type="button"
        onClick={() => void copy()}
        className="mt-3 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 font-ui text-sm font-medium text-paper-app transition-shadow hover:shadow-letter-lifted"
      >
        {copied ? <Check size={15} /> : <LinkIcon size={15} />}
        {copied ? 'Copied' : 'Copy invite link'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Write the join route**

Create `src/routes/JoinPartner.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PaperTexture } from '../design/PaperTexture'
import { useAuth } from '../auth/useAuth'
import { profileRepository } from '../data'

type Status = 'working' | 'linked' | 'failed'

export default function JoinPartner() {
  const { inviteCode } = useParams<{ inviteCode: string }>()
  const { userId, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>('working')
  const [message, setMessage] = useState('')
  // The link must be applied exactly once, even under StrictMode's
  // double-invoked effects — a second attempt would report ALREADY_LINKED
  // against the link this very component just made.
  const attempted = useRef(false)

  useEffect(() => {
    if (userId === null || inviteCode === undefined) return
    if (attempted.current) return
    attempted.current = true

    void (async () => {
      const result = await profileRepository.linkPartner(userId, inviteCode)
      if (result.error !== null) {
        setStatus('failed')
        setMessage(result.error)
        return
      }
      await refreshProfile()
      setStatus('linked')
    })()
  }, [userId, inviteCode, refreshProfile])

  const alreadyLinked = profile?.partnerId != null && status === 'failed'

  return (
    <div className="mx-auto max-w-[420px] pt-10">
      <PaperTexture className="p-8 text-center sm:p-10">
        {status === 'working' && (
          <p className="font-letter text-ink-letter">Connecting you two…</p>
        )}

        {status === 'linked' && (
          <>
            <h1 className="font-hand text-4xl text-ink-ui">You're connected</h1>
            <p className="mt-3 font-letter text-ink-letter">
              Write them something.
            </p>
            <button
              type="button"
              onClick={() => navigate('/compose', { replace: true })}
              className="mt-6 rounded-full bg-accent px-6 py-2.5 font-ui text-sm font-medium text-paper-app transition-shadow hover:shadow-letter-lifted"
            >
              Write a letter
            </button>
          </>
        )}

        {status === 'failed' && (
          <>
            <h1 className="font-hand text-3xl text-ink-ui">
              {alreadyLinked ? 'Already connected' : 'That link did not work'}
            </h1>
            <p className="mt-3 font-letter text-ink-letter">{message}</p>
            <Link
              to="/"
              className="mt-6 inline-block font-ui text-sm text-ink-muted underline underline-offset-4 hover:text-accent"
            >
              Back to your letters
            </Link>
          </>
        )}
      </PaperTexture>
    </div>
  )
}
```

- [ ] **Step 3: Show the invite link in the unlinked empty state**

In `src/routes/Inbox.tsx`, add the imports:

```tsx
import { useAuth } from '../auth/useAuth'
import { InviteLink } from '../components/InviteLink'
```

Inside the `Inbox` function, after the existing `useLetters()` call, add:

```tsx
  const { profile } = useAuth()
```

Then replace the empty-state block — the one rendering "No letters yet" — with:

```tsx
  if (letters.length === 0) {
    const unlinked = profile !== null && profile.partnerId === null

    return (
      <div className="py-24 text-center">
        <p className="font-hand text-3xl text-ink-ui">
          {unlinked ? 'Just you so far' : 'No letters yet'}
        </p>
        <p className="mx-auto mt-3 max-w-sm font-letter text-ink-letter">
          {unlinked
            ? 'Send them this link. Once they open it, you can write to each other.'
            : `When ${partnerName || 'they'} write to you, it will arrive here.`}
        </p>

        {unlinked && profile !== null ? (
          <InviteLink inviteCode={profile.inviteCode} />
        ) : (
          <Link
            to="/compose"
            className="mt-8 inline-block rounded-full bg-accent px-6 py-2.5 font-ui text-sm font-medium text-paper-app transition-shadow hover:shadow-letter-lifted"
          >
            Write the first one
          </Link>
        )}
      </div>
    )
  }
```

- [ ] **Step 4: Register the route**

In `src/app/App.tsx`, add the import:

```tsx
import JoinPartner from '../routes/JoinPartner'
```

and add inside `<Routes>`:

```tsx
              <Route
                path="/join/:inviteCode"
                element={
                  <RequireAuth>
                    <JoinPartner />
                  </RequireAuth>
                }
              />
```

`RequireAuth` already remembers the attempted path in location state, so someone opening an invite link while signed out signs in and is returned to it.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm test && npm run build && npm run lint
git add src/routes/JoinPartner.tsx src/components/InviteLink.tsx src/app/App.tsx src/routes/Inbox.tsx
git commit -m "feat: add invite link and partner joining"
```

Expected: all clean, 28 tests passing.

---

### Task 9: Go live

The only task that needs the Supabase project. Everything before this is verified against the mock; this is where the swap is proven with two real accounts.

**Files:**
- Create: `.env` (local only, never committed)

- [ ] **Step 1: Create the project and apply the SQL**

Follow `supabase/README.md` steps 1 through 4 exactly. If you are an agent and cannot reach the dashboard, STOP here and hand back to the user with the README's steps — do not fabricate credentials or claim this step was done.

- [ ] **Step 2: Confirm the adapter is live**

```bash
npm run dev
```

The app should now show the sign-in screen rather than the mock inbox. If it still shows letters immediately, `.env` is missing or the dev server was not restarted — Vite reads env only at startup.

- [ ] **Step 3: Verify the confidentiality boundary before creating real data**

In the Supabase dashboard's SQL editor, run:

```sql
set role anon;
select * from letters;          -- expect: 0 rows (RLS blocks anonymous reads)
select * from profiles;         -- expect: 0 rows
select * from public_letters;   -- expect: 0 rows now; shared letters appear here later
reset role;
```

If `letters` or `profiles` returns any row under `set role anon`, STOP. RLS is not doing its job and no real letters should be written until it is.

- [ ] **Step 4: Walk the two-person flow**

Do this with two browsers, or one normal and one private window, so two sessions exist at once.

1. Browser A: sign up as the first account. You should land on `/setup`.
2. Enter a name, continue. You should land on the inbox showing "Just you so far" and an invite link.
3. Copy that link.
4. Browser B: open the link. You should be sent to `/auth`.
5. Sign up as the second account, enter a name.
6. You should be returned to the invite link and see "You're connected".
7. Browser B: write and send a letter.
8. Browser A: reload. The letter should be there, with an unread dot and the correct sender name.
9. Browser A: open it. The dot should clear. Reload — it should stay cleared.
10. Browser A: reply. Browser B should see it after a reload.

- [ ] **Step 5: Verify the authorization boundary**

Still signed in as the second account, in the browser console:

```js
const { data, error } = await window.__sb.from('letters').select('*')
```

This requires exposing the client for the check — temporarily add `if (import.meta.env.DEV && supabase) (window as unknown as Record<string, unknown>).__sb = supabase` at the end of `src/data/supabaseClient.ts`, and REMOVE it before committing.

Expected: only letters where you are sender or receiver. Then attempt a letter to a stranger:

```js
await window.__sb.from('letters').insert({
  sender_id: '<your id>', receiver_id: '<any other uuid>', message: 'nope'
})
```

Expected: a row-level security error. If this insert succeeds, the `letters_insert_own_to_partner` policy is wrong — stop and fix it before going further.

- [ ] **Step 6: Record the outcome and commit**

Remove the temporary `__sb` line. Then:

```bash
npm run typecheck && npm test && npm run build && npm run lint
git status --short   # .env must NOT appear
git add -A
git commit -m "chore: verify Supabase go-live"
```

Append a short "Verified on <date>" note to `supabase/README.md` recording which steps passed, so the next person knows the flow was exercised end to end.

---

## What Phase 3 deliberately leaves out

These belong to Phase 4 and 5 and must not be built here:

- The share button, the `/letter/:slug` public route, and the toast. `share` and `getBySlug` exist on both adapters and are covered by the contract suite, but no UI calls them yet.
- Realtime letter arrival, a sent folder, delete, and multiple letter fonts — out of v1 scope entirely.
- The text-contrast decision recorded in the carry-over doc. It is the user's call and is not an implementation task.
- Deploying to Vercel — Phase 5.
