# brain.md — instascrapper project overview

Internal orientation doc for working sessions on this codebase. Not user-facing docs — read this before re-exploring the codebase from scratch.

## What this app is

A Next.js 16 app that monitors Instagram accounts ("targets") for changes — new posts/reels, stories, profile edits, follower/following count and identity churn — without using Instagram's official API for most of it. It scrapes via TLS-fingerprint impersonation (`@dryft/tlsclient`) through residential/datacenter proxies (Webshare), optionally authenticated with real (burner) Instagram account sessions for features Instagram gates behind login. Results are diffed against stored snapshots; diffs become `Event`s; events fan out to notification channels (Discord/ntfy/webhook).

Stack: Next.js 16 (App Router, Turbopack) · React 19 · Prisma 7 (custom generator, client at `lib/generated/prisma`, imported via `@prisma/client` alias) · Postgres (Prisma Postgres pooled instance) · NextAuth (JWT sessions) · Tailwind 4 + Radix/shadcn UI · pnpm.

**Read `AGENTS.md` first if you haven't** — this Next.js version has non-standard conventions documented in `node_modules/next/dist/docs/`.

## Mental model: the three layers

```
UI (app/(app)/...)  →  API routes (app/api/...)  →  lib/services/*.service.ts  →  lib/meta/* (scraping) + prisma
```

- **UI** never talks to Prisma or the scraping engine directly — always through `apiFetch()` (`lib/fetcher.ts`) hitting an API route.
- **API routes** are thin: `requireUserId()` (`lib/api-helpers.ts`) for auth, Zod-validate the body (`lib/validation/*.ts`), call a service function, `jsonError()` on catch.
- **Services** (`lib/services/`) hold the actual business logic and are the only layer that should import `prisma` directly for target/monitor/event/notification logic.
- **`lib/meta/`** is the scraping/provider abstraction — swappable between MOCK, GRAPH (official Meta API, mostly unused/optional), and STEALTH (the real path). See below.

## The scraping engine (`lib/meta/`)

- **`provider-factory.ts`** — `getMetaProvider()` returns one of `MockMetaProvider` / `GraphMetaProvider` / `StealthMetaProvider` based on `INSTAGRAM_PROVIDER_MODE` env var (`STEALTH` is what's actually used; `MOCK_META_API=false` also forces STEALTH). This is the *only* place code should ask "give me the provider."
- **`stealth-provider.ts`** — thin adapter implementing `MetaProvider`, delegates to `stealth-engine-bridge.ts`.
- **`stealth-engine-bridge.ts`** — the real engine. Key exports:
  - `stealthResolveTarget(username, session?)` — resolves a username to profile existence/type/eligibility. Used by add-target and the resolve-preview flow.
  - `stealthFetchTargetData({ username, externalId, session?, options? })` — the actual per-check scrape: profile fields, media, reels, (if authenticated + `watchStories`) stories, (if authenticated + `watchFollowerChurn`) followers **and** following ID lists via `fetchFriendshipIdList()`.
  - Two coherent TLS/header identities are maintained: Chrome-desktop (`www.instagram.com`) and iOS-app (`i.instagram.com`), matched to whichever host is being called — mismatching them trips Instagram's WAF ("useragent mismatch"). Don't send iOS headers to www endpoints or vice versa.
  - `DEFAULT_PROXY_URL` (env) is injected as a fallback proxy on every request when a session doesn't specify its own `proxyUrl` — this is what makes anonymous scraping work at all (raw server IPs are already Instagram-blocked).
  - Failure classification (`classifyBlock`) distinguishes rate-limit vs. session-flagged vs. IP-blocked vs. genuinely-gone by probing `instagram`'s own public profile as a control — avoids flat `NOT_FOUND` on a live account.
  - Proxy auth failures (407) are tagged distinctly (`PROXY_AUTH_FAILED`) so they don't get misreported as a generic Instagram block.
  - **`fetchProfileInfoWithFallback()` is the single entry point for profile data**, and it walks a 4-step fallback chain (see next section). Anything needing profile fields must go through it rather than calling an endpoint directly.
  - **`htmlPageFetch()`** is a *separate transport* from `stealthRequest()`, used only for HTML pages, for two reasons: `stealthRequest` sends XHR headers (`Sec-Fetch-Dest: empty`, `X-Requested-With`) which are wrong for a document navigation, and `@dryft/tlsclient`'s axios adapter hardcodes `withoutCookieJar: true` / `withDefaultCookieJar: false` plus a fresh `sessionId` per request, so it can't control the cookie jar at all. `htmlPageFetch` drives the worker pool directly and uses a **fresh jar per request** (see the jar-policy measurements below).
  - `resolveFrom()` exists because a bare `require.resolve()` of a deep subpath resolves relative to *this module*, which isn't stable once a bundler has traced the output. Note `workerpool` is a **transitive** dep of `@dryft/tlsclient`, so it must be resolved from that package's directory — the project root alone won't find it in a nested `node_modules` layout.

### Anonymous profile data: the JSON API is dead, the HTML page is not

As of the last empirical sweep, **every logged-out JSON endpoint is walled**. Measured through the Webshare proxy with a Chrome TLS fingerprint:

| Endpoint | Result |
| --- | --- |
| `GET /api/v1/users/web_profile_info` (`www`) | **401** `{require_login: true, igweb_rollout: true}` |
| `GET /api/v1/users/web_profile_info` (`i.`) | **401** same body |
| `GET /api/v1/users/<u>/usernameinfo` (`i.`, iOS UA) | **403** `{message: "login_required"}` |
| `GET /graphql/query?doc_id=…` | **400** invalid request |
| `GET /<u>/?__a=1&__d=dis` | **201**, empty body |
| `GET /<u>/` (server-rendered HTML) | **200 — full profile data** ✅ |

Things that were tested and are **not** the cause, so don't re-litigate them: proxy IP reputation (fresh creds behave identically), TLS/JA3 fingerprint, target choice (`nasa` fails the same as a small account), and cookie-jar warmup on the *API* call.

So `fetchProfileInfoWithFallback` tries www JSON → `i.` JSON → GraphQL → **HTML page**, and in practice only the last step succeeds anonymously. It runs for authenticated callers too, because a flagged session fails the JSON API the same way.

**The login-shell coin flip.** Logged-out profile requests are frequently served a generic login shell instead of the profile — same HTTP 200, ~500KB, with `og:url = https://instagram.com/` (the real page is ~730–850KB with `og:url = https://www.instagram.com/<user>/`). This is a soft block, not a failure, and retrying works. Measured hit rates on `@nasa`:

- fresh cookie jar per request → **1/8** real pages
- one reused jar, straight to the profile URL → **6/6** real pages
- warm the homepage first, then the profile → **1/6** (actively *worse* — the shell cookies steer the edge toward serving the shell again)

Hence: persistent jar, no homepage warmup, and up to 6 attempts. Note this means `bootstrapAnonymousCookies()` (which hits the homepage) must stay **out** of the HTML path.

- **`html-profile-scraper.ts`** — the HTML path, deliberately isolated so it can be deleted without touching anything else. Sole export `scrapeProfileHtml(username, fetcher, opts)`; the transport is injected, so the module is pure parsing and has no dependency on the bridge. It **normalises into the legacy `web_profile_info` shape** (`edge_followed_by.count`, `edge_owner_to_timeline_media.edges[].node`, …), which is why adding it required zero downstream changes. Internals worth knowing:
  - Real data comes from a Relay prefetch payload embedded in the page: an `xig_user_by_username` object (exact `follower_count`/`following_count`, `biography`, `full_name`, `pk`, `is_private`, `is_verified`, `bio_links`) plus a second occurrence holding `polaris_ordered_timeline_connection` with the first 12 posts (`code`, `caption.text`, `display_uri`, `media_type`, `product_type`). `product_type === "clips"` is how reels are separated from posts.
  - Extraction is a **brace-matching walk** (`extractObjectAfter`), not a regex — the payload is too deeply nested for one, and it must be string-aware so braces inside string literals don't break nesting.
  - **`pk` is the user id** used by the friendships/stories endpoints. The sibling `id` field is the IG-business id and is *not* interchangeable.
  - `all_media_count` is always `null` when logged out, so **post count comes from `og:description`** ("4,923 Posts"). Caveat: for large accounts that string is abbreviated ("51K Posts" → 51000), so `mediaCount` is approximate for big targets and should not be trusted for exact new-post detection — diff the media list instead.
  - The logged-out payload carries **no media timestamps and no video URLs**, so `taken_at_timestamp`/`video_url` are null on HTML-sourced media.
  - A `404` is authoritative (returned immediately as NOT_FOUND). A `429` bails after 2 hits rather than burning the attempt budget, and the bridge surfaces it as RATE_LIMITED instead of the JSON API's misleading 401.
- **`types.ts`** — the shared contract: `TargetResolution`, `TargetFetchResult`, `StealthSessionConfig`, `MetaProvider` interface. Anything touching the scraping layer imports from here.
- **`capability.service.ts`** — maps resolution/eligibility enums between the scraping layer's string unions and Prisma's enums, plus user-facing messaging.

## Session pool (`lib/meta/session-pool.ts`)

This is the **only** module allowed to query `InstagramSession` for selection purposes — everything else asks it, never queries the table directly. Purpose: rotate load across multiple "burner" Instagram accounts (each pinned 1:1 to its own proxy via `InstagramSession.proxyUrl`) instead of hammering one account/IP, because using the user's real account risks a ban and pure-anonymous scraping gets challenged fast.

- **`peekSession(userId, { pinnedSessionId? })`** — read-only, does **not** advance rotation. Used by one-shot/interactive callers: `POST /api/targets` (create) and `POST /api/targets/resolve` (preview).
- **`pickSession(userId, { pinnedSessionId? })`** — claims a session via optimistic-lock `updateMany` (compare-and-swap on `lastUsedAt`), advancing round-robin state. Used **only** by the scheduler (`monitoring.service.ts::processTarget`).
- **`reportSessionOutcome(sessionId, { kind: SUCCESS | FLAGGED | RATE_LIMITED, ... })`** — centralizes session-record mutation after a fetch attempt (sets `cooldownUntil` on rate-limit, `status: FLAGGED` on a real block, `lastSuccessAt`/`deviceId` on success).
- Eligibility query: `status: "ACTIVE"` and (`cooldownUntil` null or past), ordered by `lastUsedAt` ascending (nulls first) — see `@@index([userId, status, lastUsedAt])` on the model.
- **This is deliberately removable**: if a user has zero `InstagramSession` rows, both `peekSession`/`pickSession` return `null` and every caller falls back to anonymous mode exactly as if the pool didn't exist. No feature flag needed — it's structurally optional.
- `InstagramSession.status` is a free-form string (not a Prisma enum) with three meaningful values: `ACTIVE` (eligible), `PAUSED` (user-disabled via dashboard, excluded from rotation), `FLAGGED` (auto-detected block, needs a manual dashboard "Reset" after the user re-solves the checkpoint in a real browser).
- `SESSION_FLAGGED` on a check does **not** always pause the target — `monitoring.service.ts::handleFailedFetch` checks whether other eligible sessions exist; if so the target goes to `BACKOFF` with a short retry so the scheduler picks a different pool session next tick. Only pauses (`PAUSED`, `nextRunAt: null`) when the whole pool is exhausted.

## Two-tier feature gating: anonymous vs. session-required

Deliberate product design, not a technical limitation to work around:

| Works anonymously (no session) | Requires an authenticated `InstagramSession` |
|---|---|
| Bio, name, website | Stories |
| Follower count | Follower **and** following identity lists / churn |
| Posts, reels | Following count *(product decision — grouped with the auth-required set for UX simplicity, even though the underlying field is technically returned by the same anonymous endpoint)* |

Both target forms (`app/(app)/targets/new/page.tsx`, `app/(app)/targets/[id]/page.tsx`) render toggles in two visually separated groups — **Basic (no login required)** always enabled, **Advanced (requires an Instagram session)** shown with a lock icon and disabled until a session is picked in the per-target session dropdown. Locked toggles are never hidden — discoverability matters more than a clean empty state here. Unpinning a target's session force-clears its three advanced flags server-side (never send `watchStories: true` with `instagramSessionId: null`).

## Target lifecycle & monitoring loop

- **Create**: `POST /api/targets` → `target.service.ts::createTarget` → resolves via `resolveTargetUsername` (uses `peekSession`) → creates `Target` + `Monitor` rows. `Target.status` starts `ACTIVE` if `isMonitorable(resolution)`, else `UNSUPPORTED`.
- **Schedule**: `Target.nextRunAt` drives everything. `app/api/cron/monitor/route.ts` (Vercel Cron, see `vercel.json`; also callable manually with `Authorization: Bearer $CRON_SECRET`) calls `runDueTargetChecks(20)` → sequentially (not parallel) calls `processTarget(id)` for each due target.
- **`processTarget`** (`monitoring.service.ts`): creates a `Job` row, resolves the session via `pickSession`, calls the provider's `fetchTargetData`, then branches to `handleSuccessfulFetch` or `handleFailedFetch`.
- **`handleSuccessfulFetch`**: uploads new media/stories/profile pic to ImageKit if configured (`lib/storage/imagekit.ts`), diffs profile fields via `diff.service.ts::detectProfileChanges` (name/bio/website/photo, follower count, following count, reels count), diffs follower/following ID lists against the previous `TargetSnapshot`'s stored lists (`followersListJson`/`followingListJson`) for churn, creates a new `TargetSnapshot`, records `Event`s for anything changed (idempotent via `(targetId, fingerprint)` unique constraint in `event.service.ts::recordEvent`), reschedules `nextRunAt` (`calculateNextRunAt` — applies jitter and restricted-hours windows).
- **`handleFailedFetch`**: branches on `sessionFlagged` / `rateLimited` / `authError` / `notFound` (needs `NOT_FOUND_CONFIRMATIONS_REQUIRED = 2` consecutive confirmations before marking a target `NOT_FOUND`, to avoid false positives from a transient block) / generic temporary failure, each with its own backoff (`backoffSeconds`, exponential, capped at 6h) and `Target.status` transition.
- **First-ever check** never emits change events (nothing to diff against) — only establishes the baseline snapshot.

## Notifications

`Event` creation → `event.service.ts::recordEvent` → `notification.service.ts::enqueueNotificationsForEvent` creates `Notification` rows per matching `NotificationChannel` (filtered by `eventTypeFilter`, respects `cooldownSeconds`). `app/api/cron/notify/route.ts` → `dispatchDueNotifications` actually sends them via `lib/notifications/dispatch.ts` → provider-specific senders in `lib/notifications/providers/{discord,ntfy,webhook}.ts`.

## Retention

`app/api/cron/cleanup/route.ts` → `retention.service.ts::runRetentionCleanup`, driven by `User.retentionDays` (default 90, editable in Settings).

## Auth

NextAuth, JWT strategy, credentials-based (`auth.config.ts` + `auth.ts`), `bcryptjs` for password hashing. `requireUserId()` in `lib/api-helpers.ts` is the standard guard at the top of every API route — throws `ApiError(401)` if unauthenticated, which `jsonError()` turns into a proper response.

## Secrets & encryption

`lib/crypto.ts` (`encryptJson`/`decryptSecret`, keyed by `ENCRYPTION_KEY` env var) encrypts `InstagramSession.encryptedCookies` and `MetaConnection.encryptedAccessToken` at rest. Never log or return decrypted cookies to the client.

## Database: how schema changes actually get applied here

**Use `npx prisma db push`, not `npx prisma migrate dev`.** This DB has pre-existing drift (columns like `InstagramSession.deviceId`, `Media.storageFileId/storageUrl`, `TargetSnapshot.profilePictureStorageId/Url` were added directly at some point without tracked migration files). `migrate dev` detects this drift and demands a full `migrate reset` (**drops all data**) to reconcile — never run that. `db push` syncs the live schema without touching migration history and is how this project is actually managed day to day. After `db push`, also run `npx prisma generate` if the generated client (`lib/generated/prisma`) doesn't auto-refresh.

Key models (`prisma/schema.prisma`): `User` → `Target` (1:1 `Monitor`, many `TargetSnapshot`/`Media`/`Event`/`Job`) · `InstagramSession` (the burner pool) · `NotificationChannel` → `Notification`. `Target.status` and `InstagramSession.status` are both plain strings, not Prisma enums — deliberately, so new status values don't need a migration.

## Known gaps / things to double-check before trusting

- `Monitor.watchFollowerChurn` is overloaded to mean "track follower **and** following churn" (one DB flag, two things) — UI labels it "Follower & following changes." Don't add a separate `watchFollowingChurn` flag without checking whether this doc is still current.
- "Following count requires a session" is a **product decision, and now a confirmed non-limitation** — the anonymous HTML path returns an exact `following_count` (verified: `@natgeo` → 194, `@puneetsuperr_star` → 59). `stealthResolveTarget`'s capability table still reports `NOT_AUTHORIZED` for it anonymously, which is a UX choice, not a technical constraint. Bio, name, website, follower count, posts and reels are likewise all confirmed working with no credentials.
- `StealthMetaProvider.resolveTarget` used to silently drop the `session` argument (fixed — see git history around this file if something regresses here).
- The mock provider (`lib/meta/mock-provider.ts`) and Graph API provider (`lib/meta/graph-provider.ts`, official Meta Business Discovery) exist but are secondary paths — `INSTAGRAM_PROVIDER_MODE=STEALTH` is the one actually used.
- Windows dev environment: the native TLS client binary is resolved manually in `stealth-engine-bridge.ts::resolveTlsLibPath()` (bundled `.dll`/`.so` under `lib/native/`), bypassing `@dryft/tlsclient`'s own OS auto-detection because it doesn't handle Windows or Vercel's Amazon Linux runtime correctly.

## Where to look for X

| Need to... | Look at |
|---|---|
| Add a new watch flag / monitor setting | `prisma/schema.prisma` (`Monitor`) → `lib/validation/target.ts` → both target form pages → `monitoring.service.ts` |
| Change how a target gets scraped | `lib/meta/stealth-engine-bridge.ts` (endpoint chain: `fetchProfileInfoWithFallback`) |
| Fix/extend anonymous (no-login) profile parsing | `lib/meta/html-profile-scraper.ts` — and read the "Anonymous profile data" section above first |
| Debug "Add Target returns no data" | Almost always the login-shell coin flip or a 429, not a parse bug. Look for `[html-scraper]` warnings in the server log; they report shell count and last status |
| Change session rotation / pool behavior | `lib/meta/session-pool.ts` only |
| Change what counts as a "change" worth notifying on | `lib/services/diff.service.ts` |
| Add a notification provider | `lib/notifications/providers/`, register in `lib/notifications/dispatch.ts` |
| Debug why a target isn't updating | Check `Job` rows (Settings → System health) and `Target.status`/`errorMessage`/`nextRunAt` first, then the relevant `handleFailedFetch` branch |
