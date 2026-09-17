# brain.md — instascrapper project overview

Internal orientation doc for working sessions on this codebase. Not user-facing docs. **Read this before exploring code**, and start with *Recent changes* below.

## Recent changes (newest first)

Short log so a new session knows what just happened. Details live in the linked sections. **Update this after every meaningful change** (keep ~15 entries).

- **2026-09-17 — Human-paced scheduler.** Checks run one at a time with random 3–15s pauses, inside a 45s budget per cron call (Vercel Hobby limit). Targets are leased while being checked, so overlapping schedulers never scrape the same account twice. Added a daily cap (300 checks), a circuit breaker (pauses after 3 soft blocks in a row), human-like interval gaps, and per-user sleep hours in the user's timezone. Hashtag browsing no longer runs for anonymous checks. → *Scheduling & human-like pacing*.
- **2026-09-17 — Agent onboarding.** `CLAUDE.md` now imports this file (`@brain.md`) so it loads automatically; `AGENTS.md` tells other agents to read it first. This log was added.
- **2026-09-17 — Per-user account limit.** Default 10, self-service up to 50, every target counts. Enforced under a per-user advisory lock in `createTarget()`; 80%/100% in-app banners plus one channel alert per crossing. Role/permission layers in `lib/access/` for future ADMIN/SUPERUSER. → *Account limits & roles*.
- **2026-09-17 — Storage moved behind a facade; Appwrite is the default.** App code imports only `@/lib/storage`; `STORAGE_PROVIDER` picks `appwrite` or `r2`. Thumbnails are rendered locally with `sharp`. **Appwrite credentials in `.env` are still placeholders, so storage is off until they're filled in.** R2 was never live either (its `.env` values were placeholders). → *Tiered media storage*.
- **2026-09-16 — 48-hour heavy-file policy + expired-media actions.** Full file kept 48h, thumbnail and row survive with `isExpired`; Re-download (re-scrapes the permalink) and Permanent delete. New `post-page-scraper.ts`. → *Tiered media storage*.
- **2026-09-16 — Mobile simulator tab** on the target detail page (`instagram-simulator.tsx`), plus `POST /api/targets/[id]/check` "Run check now". New targets are now due immediately (was one full interval).
- **2026-09-16 — Anonymous scraping fixed.** Logged-out JSON API is walled; the HTML profile page is scraped instead (`html-profile-scraper.ts`), HTML-first for anonymous callers, with lite-page id fallback. → *Anonymous profile data*.

### Decided but NOT built yet
- **60-day cleanup:** delete thumbnail file **and** row after 60 days, using a per-target `lastSeenMediaId` high-water mark for new-post detection instead of stored rows. **Blocked on verifying that Instagram media IDs always increase with post time** (incl. reels and pinned posts).
- **Profile pictures:** keep one file per target, replace only when the image actually changes (today a new copy is uploaded on every check and never deleted, ~560 uploads/day at 35 accounts).
- **Unused R2 pieces** (`/api/r2/usage`, reconcile cron, `R2UsageCounter`, AWS SDK deps) remain; remove only once R2 is definitely abandoned.

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
  - **`htmlPageFetch()`** is a small separate transport from `stealthRequest()`, used only for HTML pages, because `stealthRequest` sends XHR headers (`Sec-Fetch-Dest: empty`, `X-Requested-With`) that are wrong for a document navigation. It goes through the normal `getTlsClient()` and **leaves `followRedirects` at its default of `false`** — Instagram 302s logged-out profile requests to its login page, so a 3xx *is* the soft-block signal, and not following it avoids downloading a ~500KB login shell just to detect one.
  - ⚠️ **Never drive `@dryft/tlsclient`'s worker pool directly from app code.** An earlier version of `htmlPageFetch` did, to control the cookie jar, which required a dynamic `require(<computed path>)` of `workerpool`. That is not in `next.config.ts`'s `serverExternalPackages` and is not statically analyzable, so **Next could not bundle it and the entire HTML path threw `MODULE_NOT_FOUND` at runtime inside the app** — while passing every test run outside Next. It cost nothing to drop (measured slightly *better* without it), but it is the single most expensive trap in this file. Corollary: **verify scraping changes by hitting a route in `next dev`, not by compiling the bridge to JS and calling it directly.**

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

**Ordering matters, and it is not just a fallback chain.** `fetchProfileInfoWithFallback` branches on whether the caller is authenticated:

- **Anonymous → HTML page FIRST**, then the JSON endpoints as a long shot. Calling the walled JSON endpoints first is not free: it costs ~6 requests plus a homepage bootstrap against the same egress IP, which measurably raises the chance Instagram then answers the HTML request with the login shell. Skipping them took `@natgeo` from 8/8 shells (34s, no data) to first-try success.
- **Authenticated → JSON first**, then HTML. Their cookies can make the JSON API work, and it returns richer data (media timestamps, video URLs) than the HTML page.

**The login-shell soft block.** Logged-out profile requests are often bounced to the login page instead of the profile. Two forms, both meaning "try again": a **302** redirect (what we see now, since we don't follow redirects — instant, empty body), or an inline **200** login shell (~500KB, `og:url = https://instagram.com/`; a real page is ~700–850KB with `og:url = https://www.instagram.com/<user>/`).

Measured hit rate is only **~15–25% per attempt**, and these levers do *not* move it:

- one pinned/reused cookie jar → **0/8** (a stuck jar never recovers, so pinning is actively harmful)
- fresh jar per request → **~1–2/8** (what we do)
- warm the homepage first → **1/6**, actively worse; keep `bootstrapAnonymousCookies()` **out** of the HTML path
- crawler user-agents → Googlebot **0/5**, `facebookexternalhit` **1/5**, Twitterbot **1/5**

> An earlier version of this doc claimed a reused jar scored 6/6. **That did not reproduce** — it was a jar that happened to already be working. Don't build on it.

So the only real lever is **many cheap retries**: 14 attempts with short near-flat delays (~13s worst case), which measured 5/5 end-to-end on the account that used to fail. The per-attempt odds are a proxy-IP-freshness property, not something to fix in code.

- **`html-profile-scraper.ts`** — the HTML path, deliberately isolated so it can be deleted without touching anything else. Sole export `scrapeProfileHtml(username, fetcher)`; the transport is injected, so the module is pure parsing and has no dependency on the bridge. It **normalises into the legacy `web_profile_info` shape** (`edge_followed_by.count`, `edge_owner_to_timeline_media.edges[].node`, …), which is why adding it required zero downstream changes. Internals worth knowing:
  - Real data comes from a Relay prefetch payload embedded in the page: an `xig_user_by_username` object (exact `follower_count`/`following_count`, `biography`, `full_name`, `pk`, `is_private`, `is_verified`, `bio_links`) plus a second occurrence holding `polaris_ordered_timeline_connection` with the first 12 posts (`code`, `caption.text`, `display_uri`, `media_type`, `product_type`). `product_type === "clips"` is how reels are separated from posts.
  - **There are TWO real-page variants, and the difference broke target creation:**
    | Variant | Size | `xig_user_by_username` | Data quality |
    | --- | --- | --- | --- |
    | full | ~813KB | ✅ | exact counts, bio, website, 12 posts |
    | **lite** | **~700KB** | **❌** | og: tags only — abbreviated counts, no bio/website, no media |

    The lite page yields no `pk`, so `externalId` came back `null`: the profile resolved as `SUPPORTED` but could not be saved as a target. Handled two ways — `hasFullPayload()` makes the retry loop hold out for the full page while keeping a lite one as fallback, and `extractUserIdFallback()` recovers the id from `"profile_id"` / `profilePage_<id>` / `"props":{"id"` (all observed carrying the same id on a lite page). **A result with no id is now treated as a parse failure**, since a "successful" resolve that can't be saved is worse than an honest retry.
  - Extraction is a **brace-matching walk** (`extractObjectAfter`), not a regex — the payload is too deeply nested for one, and it must be string-aware so braces inside string literals don't break nesting.
  - **`pk` is the user id** used by the friendships/stories endpoints. The sibling `id` field is the IG-business id and is *not* interchangeable.
  - `all_media_count` is always `null` when logged out, so **post count comes from `og:description`** ("4,923 Posts"). Caveat: for large accounts that string is abbreviated ("51K Posts" → 51000), so `mediaCount` is approximate for big targets and should not be trusted for exact new-post detection — diff the media list instead.
  - The logged-out payload carries **no media timestamps and no video URLs**, so `taken_at_timestamp`/`video_url` are null on HTML-sourced media.
  - A `404` is authoritative (returned immediately as NOT_FOUND). A `429` bails after 2 hits rather than burning the attempt budget. Exhausting every attempt on soft blocks returns the synthetic **`LOGIN_SHELL_STATUS` (503)**, which both bridge callers map to a plain "Instagram served its login page, try again shortly."
  - ⚠️ **Do not let a soft block fall through to `classifyBlock()`.** It used to, and reported **`SESSION_FLAGGED`** — telling users their session was broken when they had no session at all, and (in `monitoring.service.ts`) pausing the target. That was the headline symptom of "I can't add a public account." The 503 exists specifically to keep that path honest.
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

`app/api/cron/cleanup/route.ts` → `retention.service.ts::runRetentionCleanup`, driven by `User.retentionDays` (default 90, editable in Settings). The same job also runs the 48-hour media sweep below.

## Tiered media storage & the 48-hour heavy-file policy

### Storage provider: `lib/storage/index.ts` (facade)

App code imports **only** `@/lib/storage` — never `r2.ts` or `appwrite.ts` directly. `STORAGE_PROVIDER` (`appwrite` | `r2`) picks the backend; unset means "whichever is configured, Appwrite first". Placeholder env values (`your_…`) count as unconfigured, so a half-filled `.env` disables storage instead of failing every upload.

- **Appwrite is the default** because its Cloud free plan takes no payment method: the worst case is uploads failing at a limit, never a bill. R2 has no billing hard cap, which is why `r2-guardrail.ts` exists.
- **Thumbnails are rendered locally with `sharp`** (`lib/storage/common.ts`), so no provider-side image transformations are needed. Videos get **no** thumbnail (sharp can't decode video); the old R2 path stored a fake 1×1 image, which rendered as a blank tile.
- **Appwrite file IDs** are generated (`ID.unique()`, 36-char limit); the readable path lives in the file name. Bucket needs Role **Any → read** for `<img>` URLs to load; the API key needs `files.read` + `files.write`.
- ⚠️ **Appwrite returns 404 for `project_not_found` and `storage_bucket_not_found` as well as a missing file** (verified live). Delete only treats `storage_file_not_found` as success; otherwise a wrong bucket ID would mark everything expired while leaking the files.
- ⚠️ **File IDs are provider-specific.** Switching providers with media already stored means old `storageFileId`s can't be deleted by the new provider. Let old items expire/delete first, or accept that those files remain in the old bucket.
- R2 caveat if you ever switch back: `subtractStorageEstimate` is never called, so the guardrail's storage estimate only grows and will eventually hard-stop uploads on its own.


Implemented in **`lib/services/media-storage.service.ts`** (the only module that owns this lifecycle). A `Media` row holds three tiers:

| Tier | Columns | Lifetime |
| --- | --- | --- |
| Heavy full-resolution file | `storageUrl`, `storageFileId`, `storedAt` | **deleted after 48h** |
| Super-compressed thumbnail | `thumbnailUrl`, `thumbnailFileId` | kept until permanent delete |
| Original upstream links | `sourceMediaUrl`, `sourceVideoUrl`, `permalink` | kept until permanent delete |

**Ingestion** (`uploadHeavyAndThumbnail`, called from `monitoring.service.ts`): uploads the full file, then uploads a **separate** compressed file (`w-320,q-40`). The thumbnail must be its own ImageKit asset with its own `fileId` — an ImageKit *transformation URL* (`?tr=…`) is derived from the original and would 404 the instant the policy deletes it, which is precisely what must not happen.

**The expiry clock is `storedAt`, not `firstSeenAt`.** That is what makes a re-downloaded file expire again 48h later instead of being swept on the very next run.

**Sweep** (`expireStaleMedia`): deletes the heavy file, nulls `storageUrl`/`storageFileId`, sets `isExpired`/`expiredAt`, keeps the row and thumbnail. If the storage delete fails the row is left untouched so the next run retries — marking it expired anyway would strand an unreferenced file, the exact leak this prevents. Note the cron is **daily** (`vercel.json`), so real-world expiry lands in 48–72h; run the job more often to tighten that.

**Re-download** (`redownloadMedia`): re-scrapes the **permalink** for a fresh CDN link *first*, with the stored `sourceMediaUrl` only as a fallback. This ordering is deliberate and load-bearing — Instagram CDN URLs carry an `oe=` expiry param and are typically dead by the 48h mark, so trying the stored link first would just add a guaranteed-failed request. The re-upload resets `storedAt`, so re-downloaded media is subject to the same policy.

⚠️ **Ingestion used to overwrite `mediaUrl` with the storage URL**, destroying the only pointer back to the source. `sourceMediaUrl`/`sourceVideoUrl` exist so that can't happen again — don't "simplify" them away.

**Permanent delete** (`permanentlyDeleteMedia`): removes heavy file + thumbnail + row. Because the row is also the new-post dedupe key, a still-live post can be re-detected as new on a later check — that is the accepted meaning of "permanent" here.

- **`lib/meta/post-page-scraper.ts`** — re-resolves one post's media from `/p/<shortcode>/`, injected-fetcher pattern like `html-profile-scraper.ts`. Measured far more reliable than the profile page (returned `og:image` on the **first** attempt). Reads `og:image` / `og:video`, falling back to `display_url` / `video_url` in embedded JSON. Exposed through the bridge as `stealthResolvePostMedia()` so the transport (proxy + TLS) stays in one place.
- **API**: `POST /api/media/[id]/redownload`, `DELETE /api/media/[id]`. **UI**: `features/targets/hooks/use-media-actions.ts` is shared by the dashboard gallery and the mobile simulator so the two can't drift; both render `thumbnailUrl` first and show an "Expired" badge plus exactly two actions.
- ⚠️ Any route reaching this service also reaches the bridge, so it **must** be listed in `next.config.ts`'s `stealthRoutes` or the deployed function won't have the native TLS binary.

## Scheduling & human-like pacing

Entry point: `runDueTargetChecks()` in `monitoring.service.ts`, called by `/api/cron/monitor` (external scheduler, `maxDuration = 60`) and the dev poller in `instrumentation.ts`.

**Why it's shaped this way:** Vercel Hobby kills functions at ~60s, and one anonymous check can take up to ~35s when Instagram keeps serving its login page. The old runner looped up to 20 targets back-to-back, which both timed out and looked like a bot burst. Now each call does a **small, paced slice** of work, and frequent calls (every few minutes) spread the load over time.

- **Time budget.** `DEFAULT_RUN_BUDGET_MS = 45s`. A new check only starts with ≥20s left. The deadline travels as `StealthFetchOptions.deadlineAt` into `scrapeProfileHtml` (no new retry attempt without ~11s headroom), the anonymous JSON fallback (skipped with <20s left), story/friendship extras (skipped with <12s left), and uploads (skipped with <8s left; media rows are still written so dedupe stays correct). HTML requests have a **10s timeout** (the adapter default was 30s).
- **Leases.** `Target.lockedUntil` (5 min) is claimed atomically at the start of `processTarget()` and released only if still ours. Overlapping schedulers get `SKIPPED_BUSY`. Verified: 6 concurrent checks → 1 ran, 5 skipped; two simultaneous real cron calls → only one scraped. A crashed run's lease simply expires.
- **Pacing** (`pacing.service.ts`, one `scrape_throttle` row, key `global`, shared by all users because it's one proxy IP):
  - **Daily cap:** `SCRAPE_DAILY_LIMIT` env, default **300** per UTC day, reserved with a conditional UPDATE (verified: 10 concurrent reservations at cap 3 → exactly 3). Scheduled checks are refused at the cap; "Run check now" is counted but never refused.
  - **Circuit breaker:** 3 consecutive `RATE_LIMITED`/`SESSION_FLAGGED` outcomes pause **all** scheduled checks for 15 min, doubling on each consecutive pause up to 4h. One `OK` resets it; other outcomes (e.g. not found) are neutral.
- **Human-like timing** (`lib/scheduling/time-windows.ts`, pure and unit-tested):
  - `jitterEnabled` now means human-like gaps: ~85% at 0.8–1.25× the interval, ~15% at 1.4–2.2×. Mean ≈ **1.14×**, so a 90-min target averages ~103 min.
  - **Sleep hours** per user (`User.sleepEnabled/sleepStartHour/sleepEndHour`, default on, **01:00–07:00**) in the user's timezone, windows may cross midnight. Checks due during sleep are pushed to wake time + 0–45 min spread, so mornings don't start with a burst. Settings → "Human-like check schedule" (also edits `User.timezone`, which wasn't editable before and defaults to **UTC**).
  - Per-target active hours (`restrictedHours*`) now use the **user's timezone** (was UTC) and handle midnight wrap; the end hour stays inclusive.
- **Human simulation** (`simulateHumanActions`) now runs only **with a logged-in session**, 30% of the time, and only with >30s left. Anonymous hashtag browsing was removed: it hit a walled endpoint on every check, and extra walled requests raise login-shell rates (see *Anonymous profile data*).
- **Honest limits:** pacing lowers bot-likeness and IP heat, but doesn't make scraping undetectable. The login-shell rate is driven mainly by the proxy IP. Human pacing also means fewer checks than the nominal interval.

**External trigger.** GitHub Actions scheduled runs are delayed heavily (observed 1–2h apart instead of every 5 min), so `.github/workflows/cron-trigger.yml` is only a backup. Recommended primary trigger: **cron-job.org** (free), calling `GET <APP_URL>/api/cron/monitor` every 5 min with header `Authorization: Bearer <CRON_SECRET>` and a 60s timeout. Both GitHub and Vercel need `CRON_SECRET` set to the same value, and GitHub needs `APP_URL` too; missing secrets were why the workflow failed in 3s.

## Account limits & roles (`lib/access/`, `quota.service.ts`)

Each user may monitor up to `User.maxTargets` targets (default **10**, self-service up to **50**). **Every target counts**, including paused and unsupported, so pausing can't bypass it.

Three layers, kept apart so roles can be added later without touching features:
- **`lib/access/roles.ts`**: role → policy (`defaultLimit`, `maxLimit`, `minLimit`, `warnRatio`). Only `USER` exists. Add `ADMIN`/`SUPERUSER` as a policy entry and set `User.role`; unknown roles fall back to `USER`, so a bad value can never grant more capacity.
- **`lib/access/permissions.ts`**: `can(actor, permission, subjectUserId)`. Self-service only today. "Admin may change another user's limit" goes here, not in services.
- **`lib/services/quota.service.ts`**: the only module that reads, enforces, or changes the limit. Never branches on role names.

Enforcement:
- **Authoritative check lives in `createTarget()`** via `reserveTargetSlot()`: a transaction holding `pg_advisory_xact_lock` keyed on the user, then re-count, then insert. Verified: 5 simultaneous adds at 10/12 → exactly 2 succeed. Also verified the lock works through the Prisma Postgres **pooler** (second request waited for the first).
- `assertCanAddTarget()` is a **fast pre-check** in both `/api/targets` and `/api/targets/resolve`, so a user at the limit is told immediately instead of after a ~30s Instagram lookup. It is not authoritative on its own.
- Limit can't be set **below current usage** (user must remove targets first) or outside the policy bounds. Stored values above the policy max are clamped on read.
- Errors carry a stable `code` (`TARGET_LIMIT_REACHED`, `TARGET_LIMIT_INVALID`). `ApiError` and `FetchError` now carry `code` + `details`, and **the UI matches on `code`, never on message text**.

Notifications:
- **In-app**: `TargetQuotaBanner` shows amber at 80%, red + "Raise limit" at 100%, on the targets list, add page and Settings.
- **Channels**: `sendAccountAlert()` in `notification.service.ts` sends straight to all enabled channels, not through the Event queue, because Events require a `targetId` and a limit alert isn't about a target. It ignores `eventTypeFilter`, since those select target events.
- **One alert per crossing.** `User.targetQuotaAlertLevel` records the last level sent. It is lowered automatically when usage drops (delete or limit raised), which re-arms the alert, so the delete paths need no hooks.

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
| Debug "Add Target returns no data" | Almost always a login-shell soft block or a 429, not a parse bug. Look for `[html-scraper]` warnings in the server log — they report shell count and last status. If resolve "succeeds" but the target won't save, check `externalId` (the lite-page case above) |
| Verify a scraping change | Hit a route under `next dev`. Compiling the bridge to JS and calling it directly gives **false passes** — it misses Next bundling failures, which is exactly how the `workerpool` break survived a green test run |
| Change session rotation / pool behavior | `lib/meta/session-pool.ts` only |
| Change what counts as a "change" worth notifying on | `lib/services/diff.service.ts` |
| Change check frequency, pacing, sleep hours, or cron time budget | `monitoring.service.ts` (runner + `calculateNextRunAt`), `pacing.service.ts`, `lib/scheduling/time-windows.ts` — read *Scheduling & human-like pacing* first |
| Change media storage / expiry / re-download behaviour | `lib/services/media-storage.service.ts` only — and read the 48h-policy section above first |
| Add a notification provider | `lib/notifications/providers/`, register in `lib/notifications/dispatch.ts` |
| Debug why a target isn't updating | Check `Job` rows (Settings → System health) and `Target.status`/`errorMessage`/`nextRunAt` first, then the relevant `handleFailedFetch` branch |
