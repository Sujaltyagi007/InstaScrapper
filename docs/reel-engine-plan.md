# Reel Engine — Plan

**Status (2026-09-27):** Phases 0–6 built and verified locally end to end: approve an idea → script → voice → music & mix → footage → safety check → HD render → caption → push to the phone (~4 min). Still open: render time **on Vercel** (1 vCPU), trend metrics from a **logged-in** scrape (needs a burner session). ⚠️ Gemini's free tier is ~20 requests/day per model, so the client falls back across several models.
**Replaces:** the "repost other accounts' posts" direction. We now make **original reels** based on what's trending in your niche. That is the only version that avoids copyright strikes, keeps full reach, *and* qualifies for monetization.

---

## 1. What the user experiences

1. **Pick a niche.** Type it in (e.g. "personal finance"). The app suggests accounts to watch; you confirm or add your own.
2. **See trending ideas.** The app scans those accounts, finds reels doing far better than usual, and shows **ranked reel ideas**: topic, hook, why it's trending, and the source reels as evidence.
3. **Approve an idea.** One click. From here everything is automatic.
4. **The app builds the reel from scratch:** script → AI voiceover → music and sound effects that match the trending reel's *feel* → licensed HD footage → captions → final 1080×1920 video.
5. **Review the result.** Watch the final reel with its caption, then choose **Send to phone** or **Regenerate**.
6. **You post it from your phone.** At a good posting time, a push notification (ntfy, free) brings the video link and the ready-to-paste caption. Save the video, open Instagram, paste the caption, optionally add a trending sound, post.

> **Decision 2026-09-26: posting is manual ("Send to phone").** The user is banned from Facebook, and Meta requires a Facebook account to own the developer app that official posting needs. Manual posting needs no Meta app, has zero automation ban risk, and allows Instagram's real trending sounds (which help reach). The Instagram Login code from Phase 1 stays in place in case a helper-owned app or a ban appeal makes automatic posting possible later.

---

## 2. Everything runs on Vercel

| Stage | Where it runs | Why it works on Vercel |
|---|---|---|
| Scrape niche accounts | Vercel function → **Webshare proxy + burner session** (existing engine) | Instagram blocks Vercel's own IPs (already known, see brain.md). The existing `DEFAULT_PROXY_URL` plus pinned proxies per burner already handle this. |
| Trend analysis, script, caption, visual check, audio analysis | Vercel → Gemini API | Normal HTTPS API; Vercel's default region (`iad1`, US) is supported. |
| Voiceover | Vercel → Gemini text-to-speech | Kokoro (local voice model) is too heavy for a function, so it's dropped. |
| Footage | Vercel → Pexels / Pixabay APIs | Normal APIs. Pixabay requires downloading the files to our own storage, which we do anyway. |
| Video render | **Inside a Vercel function** with `ffmpeg-static` | Hobby plan: **300s** max per call, **2 GB / 1 vCPU**, **250 MB** bundle limit. ffmpeg is ~75 MB. Rendering is its own step with its own 300s. |
| Storage | Appwrite (public URLs) | Instagram downloads the video from a public URL itself. |
| Posting | **Manual, from the user's phone** (ntfy push + mobile page) | No Meta app needed. The Instagram Login API path is built but dormant, because it needs a Facebook account to own the Meta app. |
| Scheduling | **cron-job.org** calls `/api/cron/reels` every 5 min | Vercel Hobby cron only runs once a day (already known). |

**Pipeline shape:** each reel is a `ReelProject` row that moves through stages. Each cron call **advances one stage** under a lease (the same pattern as `Target.lockedUntil`), so no single call comes near 300s. Approving an idea also triggers the first stage straight away.

⚠️ **Vercel Hobby is for non-commercial use only.** Once the account earns money, move to **Pro ($20/mo)**. Pro also allows 800s functions and 4 GB memory, which gives renders more headroom.

---

## 3. What the research changed (read before building)

### Audio: copy the *feel*, never the track
- **The API can't attach Instagram's library or trending sounds.** Music must be baked into the video file before upload. One source claims Meta added licensed-music attachment to the API; that **couldn't be verified** in Meta's docs, so Phase 0 checks it once.
- **An exact re-creation of a song is still copyright infringement** (the composition is protected, not just the recording), and Meta's audio fingerprinting catches re-uses even with pitch or speed changed. So the app **never reuses or clones** the trending audio.
- **What we build instead: an "audio blueprint".** Gemini listens to the trending reel's audio and returns its genre, mood, tempo (BPM), energy curve, where the beat drops, where sound effects hit (whoosh, pop, riser, ding), and the voice style. We then:
  - pick licensed music with the same mood and tempo from our **sound bank**,
  - place licensed sound effects at the same moments,
  - cut the footage on the beats,
  - mix it: voice on top, music lowered automatically under speech, everything at a consistent loudness, 48 kHz AAC.
- **Trending-sound option:** the **Send to phone** button gives you the finished reel with music off. You post it from the Instagram app and add the actual trending sound there, which Instagram licenses for in-app use. Only this path uses the real trending audio.

### Sound bank (licensed, curated once)
- **Pixabay Music and sound effects** (free commercial use, no credit required) have **no API**, so the bank is built once by hand: you download around 50–100 tracks and effects and upload them through an admin page. Gemini tags each one (mood, BPM, energy) on upload. We store the licence link with every file.
- **Freesound** (free sound library): only **CC0** (no-rights) sounds. Its API needs a separate licence for commercial use, so we use it for manual downloads only, not live queries.
- **Some free-library tracks have been wrongly claimed** by copyright systems before. We keep the licence record for every track so a wrong claim can be disputed.

### Visual safety check (your pasted check, now applied to our own inputs)
We no longer use other people's footage, so the Gemini visual check runs on **every stock clip we pick and on sample frames of the final render**. It rejects **watermarks, stock-agency marks, TV channel logos, sports broadcasts, movie/show scenes, brand logos or ads, other creators' on-screen text, and recognisable famous people**. Stock licences also restrict brands and identifiable people, so this check still matters. It only recognises what it sees; it doesn't search the web.

### Voice
Gemini text-to-speech, free tier about **15 requests/day** (≈ one per reel, so up to ~15 reels/day). Caption timing comes without extra calls: the script is spoken with short pauses between sentences, ffmpeg's `silencedetect` finds the sentence boundaries, and words are timed within each sentence by length. Fallback if limits get tight: Gemini's paid tier (cheap per reel), or Kokoro on a separate worker.

### HD output
- Footage: Pexels / Pixabay portrait **1080p or 4K** sources, scaled to **1080×1920**, 30 fps.
- Encode: H.264 High, `-preset veryfast`, target CRF ≈ 20, closed GOP, 4:2:0, AAC 48 kHz stereo, `+faststart`, file under 100 MB.
- ⚠️ **Sources disagree on the maximum video bitrate** Meta accepts (5 vs 25 Mbps). Phase 0 checks this against a real upload before we fix the setting.
- Instagram re-compresses every upload regardless. "HD" means giving it a clean 1080×1920 source with sharp captions and properly mixed audio.

### Account safety (unchanged rules)
- The real account **only** uses the official Instagram Login API. It never goes through `instagram-publish.ts` (private API) and never enters the scraping session pool.
- Scraping uses burners on their own proxies.
- Posting pace: default **1–2 reels/day**, at random times inside your waking hours (reuses `User.sleep*`), well under the 100/24h limit.
- **Kill switch:** for 7 days after posting, the app checks every few hours that each reel still exists. If one disappears, **all posting pauses** and you get a notification.

### Trending detection needs a burner session
View counts, post times and audio info on reels only come back on **logged-in** scrapes; the anonymous HTML page has none of them. The trend feature therefore needs **at least one active burner session**.

---

## 4. Data model (new Prisma models, applied with `npx prisma db push`)

- **`Niche`**: `userId`, `name`, `description`, `language`, `isActive`.
- **`NicheAccount`**: `nicheId`, `targetId` (reuses `Target`, so the existing scraper, pacing and leases apply), `source` (`USER` | `SUGGESTED`).
- **`Media` columns added**: `playCount`, `likeCount`, `commentCount`, `takenAt` (if not present), `audioTitle`, `audioArtist`, `audioIsOriginal`, `metricsUpdatedAt`.
- **`MediaMetricSnapshot`**: `mediaId`, `playCount`, `likeCount`, `capturedAt`. Used to measure growth speed.
- **`ReelIdea`**: `nicheId`, `title`, `angle`, `hook`, `whyTrending`, `score`, `sourceMediaIds[]`, `status` (`SUGGESTED` | `APPROVED` | `DISMISSED`).
- **`ReelProject`**: `ideaId`, `stage` (string: `SCRIPT` → `VOICE` → `AUDIO_PLAN` → `VISUALS` → `SAFETY` → `RENDER` → `CAPTION` → `READY` → `PUBLISHING` → `POSTED` | `FAILED`), `script` (JSON), `voiceUrl`, `audioBlueprint` (JSON), `clips` (JSON), `renderUrl`, `caption`, `hashtags[]`, `scheduledFor`, `igMediaId`, `attempts`, `lockedUntil`, `error`.
- **`SoundAsset`**: `kind` (`MUSIC` | `SFX`), `title`, `source`, `licenseUrl`, `moodTags[]`, `bpm`, `energy`, `durationMs`, `storageUrl`, `storageFileId`.
- **`IgAccount`**: the Instagram Login connection. `userId`, `igUserId`, `username`, `encryptedAccessToken`, `tokenExpiresAt`, `postingPaused`, `pausedReason`. Kept separate from `MetaConnection` (Facebook Login) so the two never get mixed up.

---

## 5. Phases

Each phase: 2–3 tasks, one commit per task, and nothing counts as done until its **Verify** step has actually been run. Verify on Vercel (a preview deploy), not only on localhost; brain.md records how a green local test once hid a bundling failure.

### Phase 0 — Prove the risky parts on Vercel (spike, before any real build)
**Objective:** confirm that rendering, voice and posting all work on a Vercel preview deploy.

- **Task 0.1: render test.** Add `ffmpeg-static`. Resolve its path with `createRequire(path.join(process.cwd(), "package.json"))` (the same fix as the `workerpool` trap in brain.md). Add it to `serverExternalPackages`, and include a font file via `outputFileTracingIncludes` in `next.config.ts`. Temporary route `app/api/dev/render-test/route.ts` (`maxDuration = 300`, requires `CRON_SECRET`) renders a 30s 1080×1920 video from 3 Pexels clips + a test tone + burned-in ASS captions, uploads it to Appwrite, and returns the time taken.
  - **Verify:** on a preview deploy, the route returns a playable URL. Render time is **< 150s** (headroom inside 300s); the log confirms libass captions rendered.
  - **Commit:** `feat(render): ffmpeg render spike on vercel`
- **Task 0.2: voice and Gemini test.** `lib/ai/gemini.ts` with `generateJson`, `analyzeImage`, `analyzeAudio`, `speak`. Test route: speak 3 sentences → silencedetect → sentence timings.
  - **Verify:** audio file comes back; 3 sentence boundaries detected, each within 150 ms of the pauses.
  - **Commit:** `feat(ai): gemini client with tts and audio analysis`
- **Task 0.3: posting test.** Connect your Creator account through Instagram Login (see Phase 1.1, done early) and post the Task 0.1 video as a reel. Also check: the accepted bitrate, and whether any licensed-music parameter exists.
  - **Verify:** the reel appears on the account; its `igMediaId` is recorded. Delete it afterwards.
  - **Commit:** `feat(ig): instagram login publish spike`

**Go/no-go:** if the render doesn't fit in 300s on Hobby, choose between (a) 720p renders, (b) Vercel Pro, or (c) a GitHub Actions render worker. That's decided with you, not quietly swapped.

### Phase 1 — Instagram Login connection and publishing
**Objective:** a real, refreshable, encrypted connection to your account and a reusable publish function.

- **Task 1.1:** `IgAccount` model; `lib/services/ig-account.service.ts` (OAuth code → short-lived → **long-lived 60-day token**, `ig_refresh_token` refresh, encrypted with `lib/crypto.ts`); routes `app/api/ig/connect` + `app/api/ig/callback` with **HMAC-signed `state`** (same protection as `/api/meta/callback`); Settings card "Connect Instagram".
  - **Verify:** connect → `IgAccount` row created with an encrypted token; `tsc --noEmit` clean.
- **Task 1.2:** generalise `lib/meta/graph-publish.ts` to take the API host (`graph.facebook.com` or `graph.instagram.com`). Add a daily token refresh to the existing `/api/cron/refresh-meta-tokens`.
  - **Verify:** the Phase 0 video posts through the shared function; `next build` clean.

### Phase 2 — Niche and trend data
**Objective:** reliable metrics for every reel from the niche accounts.

- **Task 2.1:** `Niche`, `NicheAccount` models; `lib/services/niche.service.ts`; page `app/(app)/studio/niche/page.tsx`. Gemini suggests accounts; **each suggestion is checked with `stealthResolveTarget`** before it's shown, because Gemini can make up usernames. Confirmed accounts become `Target`s in `NEW_POSTS_ONLY` mode.
- **Task 2.2:** capture `playCount`/`likeCount`/`commentCount`/`takenAt`/audio fields from the logged-in scrape in `stealth-engine-bridge.ts`, and write `MediaMetricSnapshot` rows on every check.
  - **Verify:** after 2 checks of one account, its reels have play counts and 2 snapshots each.

### Phase 3 — Trend scoring and idea suggestions ✅ built (2026-09-27)
**Objective:** ranked, explainable reel ideas.

- **Task 3.1:** `lib/services/trend.service.ts`. **Outlier score** = the reel's views ÷ the median views of that account's last 20 reels, combined with growth speed (views per hour between snapshots) and recency (last 7 days). This is pure logic, so it gets unit tests.
- **Task 3.2:** Gemini groups the top outliers by topic and writes `ReelIdea`s (title, angle, hook, why it's trending, sources). UI: *(built as a "Trending ideas" card on the Studio page, `features/studio/components/ideas-card.tsx`)* with Approve / Dismiss.
  - **Verify:** unit tests pass; on real data the ideas page shows ideas linked to their source reels.

### Phase 4 — Script, voice and audio ✅ built (2026-09-27)
**Objective:** an approved idea turns into a mixed audio track.

- **Task 4.1:** `ReelProject` model and `lib/services/reel-pipeline.service.ts` (`advanceReelProjects()`, lease + one stage per call); route `app/api/cron/reels/route.ts` (`maxDuration = 300`). Stages `SCRIPT` (Gemini writes a 20–45s script with a hook, based on the idea but not copying the source) and `VOICE`.
- **Task 4.2:** `SoundAsset` model + upload *(built as a per-user "Sound bank" card on the Studio page; files ≤4 MB or a direct link)* with Gemini tagging. `AUDIO_PLAN` stage: download the trending reel's audio with ffmpeg → Gemini audio blueprint → pick music + sound effects → mix (music lowered under voice, overall loudness levelled).
  - **Verify:** approving an idea produces a mixed `.m4a` in Appwrite within 3 cron ticks; listening test passes.

### Phase 5 — Footage, safety check and render ✅ built (2026-09-27)
**Objective:** a finished HD reel.

- **Task 5.1:** `lib/visuals/pexels.ts` *(Pixabay not added: Pexels alone had enough portrait footage, and it needs no extra key)*. `VISUALS` stage: Gemini turns each script line into search terms; portrait HD clips only; files downloaded to Appwrite (Pixabay forbids hotlinking).
- **Task 5.2:** `lib/services/visual-safety.service.ts`. `SAFETY` stage: every clip is checked; rejected clips are replaced (up to 3 tries per line, then the project fails with a clear reason).
- **Task 5.3:** `lib/render/` (ffmpeg command builder, ASS caption styling, cuts on the beats). `RENDER` stage → 1080×1920 MP4 in Appwrite, then a safety check on sample frames of the output.
  - **Verify:** end-to-end, an approved idea becomes a playable HD reel with captions timed to the voice; all stages finish inside 300s on the preview deploy.

### Phase 6 — Caption, review and Send to phone ✅ built (2026-09-27)
**Objective:** a finished reel reaches the user's phone at a good time, ready to post in a few taps.

- **Task 6.1:** `CAPTION` stage: Gemini writes a short caption (hook line, 1–2 lines, call to action, 3–5 niche hashtags). Review page `app/(app)/studio/reels/[id]/page.tsx` with the video, a **Copy caption** button, **Download**, **Regenerate**, and **Send to phone**.
- **Task 6.2:** Send to phone: schedule a push at a human-like time inside waking hours (reuses `User.sleep*`), max N per day. Sent through the existing ntfy channel (`lib/notifications/providers/ntfy.ts`) with the video link and caption. A mobile-friendly `/studio/reels/[id]` page gives one-tap download + copy on the phone. The user marks it **Posted** (optionally pasting the reel link) → `POSTED`.
- **Task 6.3:** keep the render file until the user marks it posted (the 48h media expiry must not delete a reel still waiting to be posted).
  - **Verify:** a scheduled reel's notification arrives on the phone in its window; the phone page downloads the HD file and copies the caption; marking it Posted updates the status.
- *(Dormant)* If automatic posting becomes possible (helper-owned Meta app or ban appeal), add **Post now** via the Phase 1 `publishToInstagram()` + a kill switch that checks each posted reel still exists.

---

## 6. Accounts and keys you'll need

| What | Where | Card? |
|---|---|---|
| Instagram account switched to **Creator** | Instagram app settings | No |
| Meta developer app with **Instagram API with Instagram Login**, your account added as a tester | developers.facebook.com | No |
| `GEMINI_API_KEY` | aistudio.google.com (Google login) | No |
| `PEXELS_API_KEY` | pexels.com/api | No |
| `PIXABAY_API_KEY` | pixabay.com/api/docs | No |
| Appwrite project + bucket (real values, not placeholders) | cloud.appwrite.io | No |
| At least one burner Instagram session + its proxy | existing Sessions page | No |
| cron-job.org job hitting `/api/cron/reels` every 5 min | cron-job.org | No |

Also set `INSTAGRAM_PROVIDER_MODE=STEALTH` explicitly. Otherwise, with `META_APP_ID` set, the app switches to GRAPH mode, which needs a Facebook Page.

---

## 7. Honest limits

- **Free tiers change.** Gemini limits especially have moved several times. The pipeline shows a clear "quota reached, resumes tomorrow" state instead of failing silently.
- **Quality depends on the prompts,** and stock footage can feel generic. Expect a few rounds of adjusting scripts and styles after Phase 5.
- **Reused templates get pushed down too.** Scripts, voices, caption styles and pacing should vary from reel to reel.
- **Meta's AI-disclosure rules** apply to realistic AI-generated audio or video depicting real people or events. A narrated explainer over stock footage is probably fine, but check before scaling up.
- **Monetization still needs an audience.** The plan makes the account *eligible*; growing it takes consistent posting over months.
