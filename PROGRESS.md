# PROGRESS

Live status per `docs/6-Implementation-Plan.md`. One phase at a time.

| Phase | Status |
|---|---|
| 0. Setup | ✅ Complete |
| 1. Database | ✅ Complete (verified in live DB) |
| 2. Authentication | ✅ Complete (migrated to Clerk Pro for email-code passwordless auth) |
| 3. Core UI | ✅ Complete (user-verified working) |
| 4. Main Features | ✅ Complete (user-verified working) |
| 5. Trust & Moderation | 🟨 Code complete — DB live; only multi-user moderation test pending |
| 6. Nice-to-have Integrations | ⬜ Deferred until core loop is validated |
| 7. Testing | ⬜ Not started |
| 8. Deployment & Launch | ✅ Complete — live on https://www.worth-it.live (user-verified auth end-to-end) |
| 9. Final Polish | ⬜ Not started |

## What was actually built

### Phase 0 — Setup (pre-session)
- Vite + React 19 + TypeScript scaffold, Tailwind v4 (CSS-first theme in `src/index.css`), `vite-plugin-pwa` configured with manifest + Supabase REST runtime caching
- All deps installed: supabase-js, TanStack Query, React Router, React Hook Form, Tabler Icons, oxlint
- Route shells for all 7 screens in `src/App.tsx` (placeholders)
- Hand-written DB types in `src/types/database.ts`

### Phase 1 — Database (this session)
- All schema now lives in a single migration `supabase/migrations/20260827000000_init.sql` (tables, indexes, triggers, RLS policies) per docs/5:
  - `users`, `items`, `ratings`, `reports` with all check/unique constraints (incl. `unique(user_id, item_id)` and `unique(rating_id, reported_by)`)
  - indexes from docs/5 §3
  - `on_auth_user_created` → auto-populate `public.users`; `updated_at` maintenance triggers for items/ratings
  - RLS enabled everywhere + policies from docs/5 §5, `is_admin()` / `is_banned()` helpers; column-level lockout so users can only UPDATE their own `room_number`
- Added minimal `supabase/config.toml` (required for the GitHub integration to recognize the project).
- Created `supabase/seed.sql` — 10 idempotent sample items (**must be run manually** in the SQL editor — the Git integration does not apply seed files).

**Correction this session:** first attempt put SQL in `supabase/schemas/`, which the GitHub deploy pipeline ignores (that folder is a local-CLI-only declarative layer that must be diffed into migrations). Moved everything to `supabase/migrations/`. The pipeline then failed anyway with *"Remote migration versions not found in local migrations directory"* — the remote `supabase_migrations.schema_migrations` table held versions with no matching local files. Rather than repair migration history, we switched to applying SQL by hand in the SQL editor (see decisions).

**Verified in the live DB** via `select` against `pg_tables` / `pg_policies`: 4 tables, RLS enabled on all 4, 13 policies, 10 seeded items.

### Phase 2 — Authentication (this session)
- **Auth context** — `src/lib/auth.tsx` (AuthProvider) + `src/lib/auth-context.ts` (useAuth): silent `supabase.auth.getSession()` on load with splash spinner (App Flow §1) and an error/retry state if it throws; `onAuthStateChange` keeps React in sync. Session persistence across refreshes needs no custom code — supabase-js stores/refreshes the token in localStorage.
- **Login screen** (`src/pages/LoginPage.tsx`), two-step unified login/signup per App Flow §4:
  - Step 1: email field (inline "Enter a valid email", submit disabled until valid, spinner while sending) + optional room number (React Hook Form, per stack)
  - Step 2: single 6-digit code field (`inputMode="numeric"`, `autoComplete="one-time-code"` for mobile keyboard/autofill), Verify with spinner, resend link with 30s countdown cooldown
  - Error mapping: wrong code → "That code's not right. Try again." with the field cleared and refocused; expired → "That code expired. Resend a new one." with the resend link emphasized; send failures → friendly rate-limit/offline copy
- **Supabase calls:** `signInWithOtp({ email, options: { shouldCreateUser: true } })` (unified login/signup) and `verifyOtp({ email, token, type: 'email' })` — the documented email-OTP verification type.
- **Redirect-after-login:** Login returns to `location.state.from` (internal paths only) or Home; `/profile` redirects to `/login` with `from: '/profile'` when logged out.
- **Profile shell** (`src/pages/ProfilePage.tsx`): avatar initial, email, room-number chip from `public.users`, Log out → navigates Home and clears the session (navigates before signOut so the auth guard doesn't intercept). My Reviews list is Phase 4 per the plan.
- **`src/hooks/useProfile.ts`:** TanStack Query for the current user's `public.users` row (loading skeleton / error+retry / success states).

## Decisions / deviations from docs

- **Migration approach: manual.** TRD suggests Supabase CLI migrations, and we briefly tried the GitHub integration; both were dropped. Schema is applied by pasting SQL into the Supabase SQL editor. `supabase/migrations/20260827000000_init.sql` + `supabase/seed.sql` remain in the repo as the written record — they must be updated by hand alongside any editor change, or the repo drifts from the DB. Acceptable for a solo hobby project; revisit if a second developer joins.
- **Admin writes:** admins manage menu/reports via dashboard/service-role paths that bypass RLS; no separate admin client needed for MVP.
- **`supabase/config.toml`** is now vestigial (only the abandoned integration read it). Harmless; left in place.
- **Room number is saved after OTP verification, not at OTP-send time.** RLS allows a user to update only their own `room_number` column and only with an active session, so the write happens post-verify; it's best-effort and never blocks login.
- **OTP verify uses `type: 'email'`** (per Supabase docs for codes sent by `signInWithOtp`). Expired-vs-wrong detection keys off the `otp_expired` code / "expired" message text, since Supabase doesn't return distinct friendly messages.
- **Added a "Use a different email" back-link on Step 2.** Not in App Flow §4's step-2 layout list; included because a typo'd email would otherwise dead-end the flow. Remove if unwanted.
- **Auth context split across two files** (`auth.tsx` provider component, `auth-context.ts` hook + context) to satisfy oxlint's fast-refresh rule (a file should export only components).
- **Login has no bottom nav** — the bottom nav doesn't exist yet (Phase 3); App Flow already specifies Login as a focused screen without it.

### Phase 3 — Core UI (this session)
- **Design System & Theme Overhaul:** Transitioned from dark theme to the warm light theme specified in `.agents/rules/design-system.md` and `docs/4-UIUX-Brief.md`:
  - Background `#F7EFE3`, card surfaces `#FFFBF5`, borders `#EAE0D0`, terracotta primary accent `#C1502E` (light tint `#F4C9B4`), text `#2B211B` / `#8C7F73`.
  - Rating badge palette: "Worth it" (`#E3F3E9` / `#3F8F5F`), "Skip it" (`#FBE7E5` / `#B23B3B`), "Mixed" (`#FBF0DC` / `#C98A26`).
  - Added soft warm shadow utilities (`shadow-warm`, `shadow-warm-md`, `shadow-warm-lg`) and 16–20px card radiuses.
- **Home Screen Rebuild (`src/pages/HomePage.tsx`):** Complete rebuild following the 7-level layout:
  1. Header: "WorthIt" wordmark in SemiBold warm typography + dynamic rating/item count summary.
  2. Search bar: rounded pill input (`rounded-full`), warm surface, navigates to `/search` on tap.
  3. Category chip row: horizontally scrollable, dynamically derived from schema categories (`All`, `Snacks`, `Meals`, `Beverages`), styled per design rules (`#F4C9B4` active background with terracotta text).
  4. Spotlight card (`SpotlightCard`): This week's top-rated item hero card with photo (or category-tinted placeholder), name, price, star rating, and rating badge. Tappable to detail; explicitly no CTA / "Order Now" button.
  5. Top Rated row (`TopRatedCard`): Horizontally scrollable card row with food photo, item name, price, star rating, and rating badge. Explicitly no add/plus button.
  6. Full menu list (`ItemCard`): Vertical stacked rows with name + price on left, star rating + worth-it badge on right.
  7. Bottom nav (`BottomNav`): 3 items only (Home, Search, Profile), cream background, active pill highlight behind the icon (`#F4C9B4` / `#C1502E`).
  - Implemented all four states: Success, Loading (skeleton cards + spotlight + top rated placeholders), Empty ("No items rated yet — be the first."), and Error ("Couldn't load the menu. Retry." with cached data preserved in an offline banner).
- **New Components:**
  - `src/components/CategoryPlaceholder.tsx`: Soft category-tinted fallback tiles for snacks, meals, beverages when no food photo is available.
  - `src/components/SpotlightCard.tsx`: Hero card for top-rated item.
  - `src/components/TopRatedCard.tsx`: Horizontal carousel card for community favorites.
- **Shared Component Updates:**
  - `src/components/ItemCard.tsx`: 16px radius, soft warm shadow, warm typography and borders.
  - `src/components/WorthItBadge.tsx`: Light-tint bg with dark text pairs per warm theme.
  - `src/components/StarRating.tsx`: Amber star (`#C98A26`), compact "★ 4.3" layout, size variants.
  - `src/components/SkeletonCard.tsx`: Warm cream pulse placeholders (`SkeletonCard`, `SkeletonSpotlight`, `SkeletonTopRatedCard`).
  - `src/components/Header.tsx`: WorthIt brand wordmark + summary subtitle prop + warm profile button.
  - `src/components/BottomNav.tsx`: 3-item navigation with warm pill active indicator.
- **Build & Quality:**
  - `npm run lint`: oxlint passes with 0 warnings and 0 errors.
  - `npm run build`: tsc and vite production bundle pass with 0 errors.
  - `npx impeccable detect src/`: 0 anti-patterns detected.

### UI Polish & Layout Refinement (Impeccable & Mobile Fixes)
- **Category Chips Row & Padding:**
  - Placed `px-4 py-1` directly on the horizontal scroll container so the first chip ("All") starts cleanly at 16px from screen bezel without clipping.
  - Upgraded chip buttons to `inline-flex items-center justify-center h-9 px-5 rounded-full text-xs font-medium` with `gap-2.5` so each chip's background (`bg-card` or `bg-accent-light`) has generous 20px horizontal padding and comfortable vertical padding around the label text.
- **Top Header & Mobile Safe Areas:**
  - Added `pt-6 pb-2.5 px-4` with `max(1.5rem, env(safe-area-inset-top, 1.5rem))` in `Header.tsx` so "WorthIt" and the profile button have breathing space and never collide with phone status bars/bezels.
  - Synchronized `<meta name="theme-color" content="#F7EFE3" />` in `index.html` to warm cream.
- **Card Padding & Spacing:**
  - `SpotlightCard`: Info row padding increased to `p-4`.
  - `TopRatedCard`: Increased to `w-[140px]`, image `h-22`, padding `p-3`, margin `mt-2`.
  - `ItemCard`: Increased to `px-4 py-3.5` with `min-h-[60px]` for effortless touch-targets.
  - `SkeletonCard`: Fully synchronized skeleton placeholder dimensions to prevent layout shifts.
- **Page Rhythm & Bottom Nav Clearance:**
  - `App.tsx`: Increased bottom clearance from `pb-16` to `pb-24` ensuring the last menu item is never obscured by the fixed bottom navigation bar.
  - `src/index.css`: Removed universal `margin: 0; padding: 0;` from `*` to let Tailwind v4 utilities control spacing cleanly.

### Phase 4 — Main Features (this session)
- **Rate & Review Screen (`src/pages/RatePage.tsx`):**
  - Built full screen following App Flow §5 with custom `RateForm` component.
  - Star selector (1–5) with 44px+ touch targets and amber fills; "Worth the price?" required Yes/No toggle pills; optional review text with 500-char counter; optional hygiene issue checkbox.
  - Form pre-fills automatically when user already has an existing rating for the item; button dynamically switches between "Submit rating" and "Update rating".
  - Network error preservation: keeps form inputs intact if mutation fails.
  - Redirects logged-out visitors to `/login` with `from: /item/:id/rate` return path.
- **Rating Upsert Mutation (`src/hooks/useSubmitRating.ts`):**
  - Uses `supabase.from('ratings').upsert(..., { onConflict: 'user_id,item_id' })` leveraging the database unique constraint.
  - Invalidates `item-detail`, `items`, and `my-reviews` TanStack Query caches on success.
- **Existing Rating Query (`src/hooks/useUserRating.ts`):**
  - Fetches existing rating for `(user_id, item_id)` to pre-fill the edit form.
- **Search Screen (`src/pages/SearchPage.tsx`):**
  - Real-time client-side search across menu item names and categories using cached `useItems()` data.
  - Auto-focuses search input on mount, includes clear `X` button, back navigation to Home.
  - All 4 states: loading skeleton, full error state with retry, empty state with clear suggestion, and filtered results list.
- **Profile Screen — My Reviews (`src/pages/ProfilePage.tsx`):**
  - Integrated `src/hooks/useMyReviews.ts` fetching user's rating history joined with item details.
  - Dynamic contribution badge (`X reviews`), review cards with item name, price, stars, worth-it badge, date, and review snippet. Tappable to navigate directly to item detail.
  - All 4 states: loading skeleton, error with retry, empty state ("You haven't rated anything yet" with "Browse menu" CTA), and populated reviews list.
- **Home Filter Chips (`src/pages/HomePage.tsx`):**
  - Added quick filter pill row ("Top rated", "Under ₹50", "Worth it") above category chips.
  - Combines filter selection with category selection in `filteredList` memo.
  - Menu list header dynamically updates with filter label and count, plus "Reset filters" CTA.
- **Toast Notifications (`src/components/Toast.tsx`, `src/components/ToastProvider.tsx`, `src/hooks/useToast.ts`):**
  - Lightweight in-house toast notification system styled in warm theme palette, positioned safely above bottom navigation.
  - Triggered on rating submission ("Rating saved" / "Rating updated").
- **Build & Quality:**
  - `npm run lint`: oxlint passes with 0 warnings and 0 errors.
  - `npm run build`: `tsc -b && vite build` passes with 0 errors.

### Phase 5 — Trust & Moderation (this session)
- **Database & Rate Limiting (`supabase/migrations/20260904000001_moderation.sql`):**
  - Added `check_rating_rate_limit()` trigger function blocking rapid spam (>5 submissions per minute per user).
  - Added `admin_ban_user(target_user_id)` security definer function allowing authenticated admins to ban abusive user accounts safely.
  - Added `Admins can delete reports` policy to enable moderation report cleanup.
- **Report / Flag Modal (`src/components/ReportModal.tsx` + `src/hooks/useSubmitReport.ts`):**
  - Built bottom-sheet modal triggered by flag icon on review cards in `ItemDetailPage.tsx`.
  - Enforces selection of report reason (`fake_spam`, `offensive`, `unrelated`, `other`) and optional freeform comment.
  - Prevents reporting own review; redirects unauthenticated visitors to login with return path.
  - Handles unique constraint (`unique(rating_id, reported_by)`) gracefully with clear "You have already reported this review" error.
- **Admin Moderation Dashboard (`src/pages/AdminPage.tsx` + `src/hooks/useReports.ts`):**
  - Gated by `is_admin` check — non-admins and logged-out users are redirected to Home (`/`).
  - Lists pending reports with reported review text, item context, author details, reporter room notes, and reason badges.
  - Provides 3 actionable workflows:
    1. "Dismiss" — marks report status as resolved (`dismissed`) with no content change.
    2. "Remove review" — prompts confirmation, deletes the flagged rating from `ratings`, and resolves report.
    3. "Ban user" — prompts confirmation, bans the review author via `admin_ban_user` RPC, and resolves report.
  - All 4 states: loading skeletons, empty queue ("No pending reports — all clear!"), error state with retry, and interactive list.
- **Profile Moderation Access (`src/pages/ProfilePage.tsx`):**
  - Added "Moderation Queue" access button visible only when `profile.data?.is_admin === true`.
- **Build & Quality:**
  - `npm run lint`: oxlint passes with 0 warnings and 0 errors across 35 files.
  - `npm run build`: `tsc -b && vite build` passes with 0 errors.

### Clerk Auth Migration (this session)
- **Supabase Auth → Clerk:** Replaced Supabase OTP auth with Clerk's email_code strategy using the `@clerk/clerk-react` SDK. Clerk handles identity, rate limiting, and email delivery.
- **Supabase Third-Party Auth:** Configured Supabase to accept Clerk-signed JWTs. Replaced `supabase.auth.getSession()` and `auth.uid()` dependencies.
- **Client Integration:** Updated `src/lib/supabase.ts` with an `accessToken` callback. Replaced the Supabase auth context with a Clerk-backed `AuthProvider`.
- **Schema Migration:** (`supabase/migrations/20260905000000_clerk_auth_migration.sql`) Changed `users.id`, `ratings.user_id`, and `reports.reported_by` from `uuid` to `text` to support Clerk IDs (e.g. `user_2abc...`).
- **RLS Policies:** Rewrote all RLS policies to use `(select auth.jwt() ->> 'sub')` instead of `auth.uid()`.
- **Profile Provisioning:** Dropped the `on_auth_user_created` Postgres trigger. Added `useEnsureProfile.ts` hook to create `public.users` row on first sign-in via the client.
- **Login UI:** Completely rewrote `LoginPage.tsx` to interface with Clerk's `useSignIn` and `useSignUp` hooks. Removed the room number collection from the login flow per user request.
- **Documentation:** Updated `docs/2-TRD.md`, `docs/5-Backend-Schema.md`, and `AGENTS.md` to reflect Clerk as the auth provider.

**⚠ Pending manual steps before the Clerk migration works end-to-end:**
1. **Apply the SQL** — paste `supabase/migrations/20260905000000_clerk_auth_migration.sql` into the Supabase SQL editor and run it. (⚠ Destructive: truncates `users`, `ratings`, `reports` — safe, test data only. It also recreates the rate-limit trigger and `admin_ban_user(text)`, so it subsumes those parts of `20260904000001_moderation.sql` if that migration hadn't been applied yet.) **Do not push/deploy until this is done** — the committed frontend sends Clerk text IDs that the pre-migration `uuid` columns would reject.
2. **Configure Third-Party Auth in Supabase** — Dashboard → Authentication → Third-Party Auth: add Clerk with the project's issuer + JWKS URL so Supabase validates Clerk JWTs (per `docs/2-TRD.md`).
3. **Env var** — ensure `VITE_CLERK_PUBLISHABLE_KEY` is set in `.env` locally and in Vercel env vars before the next deploy; the app throws at startup without it.


**Auth flow live test (this session):**
- Automated Playwright test against the dev server found that **new sign-ups were impossible**: the Clerk instance has Bot Protection (Smart CAPTCHA / Turnstile) enabled, but the custom sign-up flow never rendered the required `#clerk-captcha` mount point, so every `signUp.create()` failed with `captcha_invalid` before any code email could be sent (the UI misleadingly showed "Couldn't send the code. Check your internet connection…").
- **Fixed in `LoginPage.tsx`**: added the `<div id="clerk-captcha" />` mount point to the email step, and mapped the `captcha_invalid` Clerk error to a clear "Security check failed — disable ad blockers/VPN and retry" message.
- Sign-in path verified working up to code-send: unknown email correctly falls back to sign-up (`form_identifier_not_found`), and existing accounts receive codes (sign-ins are not captcha-gated).
- Full end-to-end OTP entry/verification can't be automated (Turnstile correctly blocks bot browsers) — needs one manual pass with a real browser + inbox. **Reminder: OTP codes are single-attempt and invalidated by every resend — always use the code from the LATEST email, and codes expire after 10 minutes.**

### Production deployment (this session)
- **Live on `https://www.worth-it.live`** (custom domain; apex 308-redirects to www). Clerk production instance's Frontend API is `clerk.worth-it.live` (registered in Supabase → Authentication → Third-Party Auth — must always match the live Clerk domain). Note: a bare `*.vercel.app` URL can never work with a Clerk production instance — its FAPI subdomain is unroutable and the `__clerk` path proxy needs server-side code holding the Clerk secret key. Always use the custom domain.
- **Domain history:** started on `worthit.eu.cc` (free TLD) — Gmail blocked all OTP mail with `550-5.7.1 "very low reputation of the sending domain"` (Transient/General bounce). Migrated everything to the purchased `worth-it.live`: Vercel domain, Clerk Change-domain (rotates the publishable key — must update `VITE_CLERK_PUBLISHABLE_KEY` in Vercel and redeploy), all Clerk email CNAMEs, and the full Resend DNS set. Old `worthit.eu.cc` DNS/Resend records can be removed.
- **OTP delivery architecture** (Clerk has no native custom-SMTP option; the supported path is webhooks):
  1. Clerk emits `email.created` (webhook, svix-signed) → Supabase Edge Function `clerk-email` (`supabase/functions/clerk-email/index.ts`, deployed via CLI with `verify_jwt = false` in `supabase/config.toml` — Clerk can't send a Supabase JWT; the function verifies Clerk's svix signature instead).
  2. Function extracts the 6-digit OTP and sends via **Resend** API from `notifications@worth-it.live`.
  3. "Delivered by Clerk" is disabled **only** on the verification-code template (Customization → Emails) to avoid duplicate sends.
  - Secrets set via `supabase secrets set` (CLI): `RESEND_API_KEY`, `CLERK_WEBHOOK_SECRET`, `RESEND_FROM`. Webhook endpoint URL: `https://ovwsbbjpuriuraajvfdh.supabase.co/functions/v1/clerk-email`.
- **Deployment gotchas hit (do not rediscover):** SPA fallback rewrite required in `vercel.json` or direct loads of `/login` etc. return Vercel 404; Bot Protection (Turnstile) silently stalls custom sign-up flows (turned OFF in the production instance); Clerk signing secrets are copy-button-only — `I`/`l` transcription broke webhook verification once; Resend auto-suppresses bounced addresses (remove recipients from Suppressions after fixing a bounce); new domains have zero reputation — expect Gmail to quarantine the first OTPs while it builds.
- `impeccable` (agent/design-QA tooling, never imported by app code) moved from `dependencies` → `devDependencies`; `npm audit fix` resolved a `fast-uri` advisory (dev-dependency chain only, now 0 vulnerabilities). The npm `allow-scripts` warnings in Vercel build logs are expected and harmless — do not approve them.
- Remaining: multi-user moderation test (Phase 5, needs a 2nd account — use a Gmail `+alias`); local dev keeps the `pk_test` dev instance on localhost.

### Menu Data Seeding & Schema Update
- **Schema & Migration (`supabase/migrations/20260904100000_add_is_veg.sql`):**
  - Added `is_veg boolean not null default true` column to `items` table.
  - Rebuilt `item_stats` view to include `is_veg` for filtering.
  - Updated `docs/5-Backend-Schema.md` and `src/types/database.ts` accordingly.
- **Restaurant Configuration (`src/config/restaurant.ts`):**
  - Static vendor profile for Saini Fast Food (contact numbers, meals served, preparation notice).
- **Menu Seeding (`data/menu-seed.json`, `scripts/seed-menu.ts`, `scripts/remove-old-demo.ts`):**
  - Stored raw JSON menu with 147 items across 16 categories.
  - Implemented deduplicated bulk seeder using service-role key.
  - Cleared 10 old demo items and re-seeded missing items for a verified 147/147 items match.

### Home Experience Refinement (Staff Frontend & Product Design)
- **Header (`src/components/Header.tsx`):**
  - Prominent WorthIt wordmark display (`/wordmark.png`), brand tagline *"Hostel food. Honest opinions."*, and authenticated user profile button.
- **Indian Veg/Non-Veg Badges (`src/components/VegBadge.tsx`):**
  - Created accessible FSSAI-style green dot and brown triangle indicator symbols, integrated into `ItemCard`, `TopRatedCard`, `SpotlightCard`, and `ItemDetailPage`.
- **Search & Filter Bottom Sheet Modal (`src/components/FilterModal.tsx`):**
  - Added slider/adjustments trigger in the search bar.
  - Bottom sheet modal supporting Price range (`Any`, `Under ₹30`, `Under ₹50`, `Under ₹100`), Sorting (`Top rated`, `Most reviewed`, `Price: Low to high`, `Price: High to low`), and Dietary (`All`, `Veg only`).
- **Visual Category Scroller (`src/lib/categories.ts`, `src/components/CategoryPlaceholder.tsx`):**
  - Built icon-driven category scroller supporting all 16 tuck shop categories with distinctive Tabler icons and warm background tints.
- **Hero Spotlight Experience (`src/components/SpotlightCard.tsx`):**
  - Redesigned 20px rounded hero banner providing immediate decision value (item, price, veg tag, star rating & count, worth-it %).
  - Clean empty/unrated handling: invites students to be the first to rate instead of displaying broken `★ — (0)`.
- **Top Rated Section (`src/components/TopRatedCard.tsx`):**
  - Added `#1`, `#2`, `#3` rank badges, veg indicators, price, star rating, and worth-it percentage pill.
- **Menu List Scanning (`src/components/ItemCard.tsx`):**
  - Upgraded to rich scannable rows with 52×52px thumbnail, veg badge, name, category, price, star rating, and worth-it consensus.
  - Responsive 2-column grid on tablet/desktop (`sm:grid-cols-2`) for fast scanning across 147 items.
- **Build & Quality:**
  - `npm run lint`: oxlint passes with 0 warnings and 0 errors across 41 files.
  - `npm run build`: `tsc -b && vite build` passes with 0 errors.
  - `npx impeccable detect src/`: 0 anti-patterns.

## Remaining manual steps (do before calling Phase 2 complete)
1. Optional: disable the GitHub integration in Supabase (Project Settings → Integrations → GitHub) to stop the failing "Supabase Preview" check on every commit.
2. **Check the Auth email template uses `{{ .Token }}`** (Dashboard → Authentication → Emails → Templates, "Magic Link"). `signInWithOtp` sends a 6-digit code only when the template includes `.Token`; with only `.ConfirmationURL` users get a magic link instead. Default templates include both, but verify.
3. Live-test the Login flow with a real inbox against App Flow §4 states: invalid email inline error + disabled submit; code send; wrong code (cleared + refocused); expired code (resend emphasized); resend 30s cooldown; redirect back to the originating screen; session survives a refresh; Log out returns to a logged-out Home.
4. After first OTP signup: confirm a `public.users` row was auto-created by the `on_auth_user_created` trigger, then set that account's `is_admin = true` manually (carried over from Phase 1).
5. Verify RLS from the client with the anon key: read `items` ✅, write ❌ (carried over from Phase 1).

## Remaining manual steps (do before calling Phase 3 complete)
1. **Paste the item_stats view SQL** (`supabase/migrations/20260904000000_item_stats_view.sql`) into the Supabase SQL editor and run it. This creates the aggregated view the Home screen queries.
2. Run `npm run dev` and verify: Home loads the seeded items from Supabase with stars/badges, filter chips work, tapping a card navigates to Item Detail, back button returns to Home.
3. Verify all four states on Home: success (items render), loading (skeletons flash briefly), empty (clear all active items, see "No items rated yet"), error (disconnect internet or use a bad key, see retry button).
4. Verify all four states on Item Detail: success (item + reviews render), loading (skeletons), empty reviews ("No reviews yet — be the first."), error (retry button, back nav still works).
5. Verify bottom nav: appears on Home/Search/Profile; hidden on `/login` and `/item/:id/rate`.
6. Verify mobile viewport (360–430px) layout and warm cream/terracotta theme palette match .agents/rules/design-system.md.

## Remaining manual steps (do before calling Phase 4 complete)
1. **Rate & Review flow**:
   - Logged out: tap "Rate this item" on Item Detail → redirects to `/login` with return path → log in → lands on Rate screen.
   - Fill stars (1–5), "Worth the price?" (Yes/No), optional text review, and optional hygiene flag.
   - Tap "Submit rating" → verify toast "Rating saved" → navigate back to Item Detail → see user review at the top with "You" badge.
2. **Edit rating flow**:
   - Tap "Edit your rating" on an already-rated item → form loads with previous stars, toggle, review text, and hygiene flag pre-filled.
   - Modify fields → submit "Update rating" → verify toast "Rating updated" → detail screen reflects new data.
3. **Home filter chips**:
   - Tap "Under ₹50" → verify list filters to items ≤ ₹50.
   - Tap "Worth it" → verify list filters to items with positive rating consensus.
   - Tap "Top rated" → verify list sorts by stars descending.
   - Combine with category chips (e.g. "Snacks" + "Under ₹50").
4. **Search screen**:
   - Tap search bar from Home → verify auto-focus on search input.
   - Type item name or category → verify real-time filtering without lag.
   - Test empty search query, no-matches state, clear button (`X`), and back arrow navigation.
5. **My Reviews on Profile**:
   - Visit Profile → verify review count badge (e.g. "1 review").
   - Verify list of submitted reviews renders with item name, price, stars, and review text.
   - Tap a review → navigates to Item Detail.
   - Test empty state when user has 0 ratings ("You haven't rated anything yet" + "Browse menu" button).

## Remaining manual steps (do before calling Phase 5 complete)
1. **Apply SQL migration**:
   - Paste `supabase/migrations/20260904000001_moderation.sql` into the Supabase SQL editor and execute it.
   - Confirms `check_rating_rate_limit()` trigger and `admin_ban_user()` RPC are created.
2. **Report Modal test**:
   - Navigate to Item Detail with reviews from another user.
   - Tap flag icon on a review → verify ReportModal opens.
   - Try submitting without selecting a reason → verify validation message.
   - Select a reason (e.g. "Fake / Spam") + optional comment → submit → verify toast "Report submitted — thanks for flagging this".
   - Tap flag on the same review again → submit → verify duplicate report message ("You have already reported this review.").
3. **Admin Moderation test (`/admin`)**:
   - Make sure current account has `is_admin = true` in `public.users`.
   - Tap "Moderation Queue" from Profile or navigate to `/admin`.
   - Verify report appears in queue with item name, review text, stars, author, reporter, and reason.
   - Test "Dismiss" action → report removed from pending list.
   - Submit another report, test "Remove review" → verify review deleted from database and item detail.
   - Submit another report, test "Ban user" → verify user is banned and cannot submit further ratings.
4. **Non-admin route guard**:
   - Test visiting `/admin` while logged out or as a non-admin user → verify redirect to Home (`/`).

## Ideas not in scope

- Code-split the main bundle (vite reports ~530 kB / 155 kB gzip after Phase 3, and it lands in the SW precache). Fine for a PWA; revisit if first load feels slow on real devices.


