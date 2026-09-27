# Setup — official Instagram API (no scraping, no proxy)

This app now runs on Meta's **official Graph API**. It reads the accounts you
monitor with **Business Discovery** and posts with **Content Publishing**, both as
your own connected Instagram professional account. There is no proxy, no burner
account and no TLS impersonation in this path — the traffic is authorized, so
there is nothing to disguise.

What this costs you in capability, up front and honestly:

| | Supported |
| --- | --- |
| Targets must be **public Business/Creator** accounts | required — personal/private accounts cannot be read at all |
| Target posts, reels, captions, media URLs, timestamps | ✅ |
| Target follower count, media count, bio, website | ✅ |
| New-post detection | ✅ by polling + diffing (no webhooks for accounts you don't own) |
| Target **stories** | ❌ never available for accounts you don't own |
| Target **follower/following identity lists** | ❌ counts only, never who |
| Target **following count** | ❌ not a Business Discovery field |

---

## 0. Facebook account + Page (required, and why)

**You need a Facebook account.** Not to use socially — as plumbing. This is the one
hard requirement, and it comes from a single fact:

> **Business Discovery is available only on the Facebook Login path.** The newer
> "Instagram Login" path (`graph.instagram.com`) can publish to your own account
> without any Facebook account or Page, but it **cannot read other accounts at
> all** — so it can't do the monitoring half of this app.

So, in order:

1. Create a Facebook account if you don't have one ([facebook.com](https://www.facebook.com)).
   You never need to post, add friends, or fill in a profile.
2. Create a **Facebook Page** (Menu → Pages → Create). It can be completely empty;
   a name is enough. The Page exists only so Instagram has something to link to.
3. In the **Instagram app** → Settings → *Account type and tools* → switch to
   **Professional account** (Business or Creator), then *Share to other apps* /
   *Link a Facebook Page* → pick the Page from step 2.

Note: registering a **Meta developer** account no longer strictly requires a
Facebook login (email works), but the Page in step 2 must be owned by a Facebook
account, so you need one regardless. Simplest path is to register the developer
account with the Facebook account you just made.

Expect friction on a brand-new Facebook account: phone verification is common, and
new accounts occasionally get checkpointed when they immediately create a developer
app. That's usually resolved by verifying a phone number and waiting a day.

---

## 1. Meta app (one time, ~10 minutes)

1. At [developers.facebook.com](https://developers.facebook.com/apps) create an app
   of type **Business**.
2. Add the **Facebook Login** product. This matters: Business Discovery is only
   available on the **Facebook Login** path (`graph.facebook.com`). The newer
   "Instagram Login" path (`graph.instagram.com`) **cannot** read other accounts,
   so it can't run the monitoring half.
3. Under Facebook Login → Settings, add this **Valid OAuth Redirect URI**:
   ```
   https://<your-app-domain>/api/meta/callback
   ```
   Add `http://localhost:3000/api/meta/callback` too for local dev.

### Permissions this app requests

```
instagram_basic              base access, both jobs
instagram_content_publish    posting to your own account
instagram_manage_insights    REQUIRED for Business Discovery
pages_read_engagement        REQUIRED for Business Discovery
pages_show_list              enumerate your Page during OAuth
```

### App Review: not required for self-use

Using the API **for your own accounts** needs only **Standard Access**, which
every Business app has by default. App Review exists to grant *Advanced* Access,
which you only need to serve *other people's* accounts.

The third-party accounts you monitor via Business Discovery are **not app users** —
they never authorize your app; you read their public data with your own token. So
they don't need to be testers, and they don't push you toward App Review.

Only the accounts whose **tokens** you use need a role (admin/developer/tester) on
the app. That's your own account.

---

## 2. Your Instagram account

The account you connect must be:

- **Business or Creator** (not personal), and
- **linked to a Facebook Page you manage**.

That Page linkage is what the Facebook Login path requires, and it's how the app
finds your Instagram professional account ID during OAuth.

---

## 3. Environment variables

```bash
META_APP_ID=...
META_APP_SECRET=...
META_GRAPH_API_VERSION=v21.0          # optional
META_REDIRECT_BASE_URL=https://your-app-domain   # optional; falls back to APP_URL / NEXTAUTH_URL
```

Nothing else is needed — **no `DEFAULT_PROXY_URL`, no Webshare credentials.**

The provider mode is chosen automatically: with `META_APP_ID` + `META_APP_SECRET`
set and no explicit `INSTAGRAM_PROVIDER_MODE`, the app uses **GRAPH**. Setting
`INSTAGRAM_PROVIDER_MODE=STEALTH` still forces the legacy scraper — don't, unless
you're deliberately going back.

Storage must be configured (Appwrite or R2). Instagram **fetches media from a
public URL** rather than accepting uploaded bytes, so reposting only works for
items that have a reachable stored URL.

---

## 4. Connect, then verify

1. Deploy (or `pnpm dev`), open **Settings**.
2. **Instagram account (official API)** → *Connect Instagram account*.
3. Approve the Facebook dialog and pick the Page linked to your Instagram account.
4. Settings should now show `@yourhandle · ACTIVE` with a token expiry.
5. Add a target that is a public Business/Creator account, then **Run check now**
   on its detail page. Posts and counts should populate with no proxy involved.

A cron job (`/api/cron/refresh-meta-tokens`, daily) refreshes the ~60-day token
before it expires, so monitoring doesn't break with a surprise 401.

---

## 5. Reposting

- **Manual:** open a media item → *Repost to my Instagram*.
- **Automatic:** per target, enable **"Auto-repost new posts to my Instagram."**
  Capped at **2 posts per check** deliberately — the publishing quota is a rolling
  24-hour window and unattended bursts are what spam heuristics look for. The real
  remaining quota is read from `content_publishing_limit` before each post rather
  than hardcoded, because Meta's own docs disagree on the number (25 vs 50 vs 100).

Reels are posted as `REELS` containers and the app waits for Instagram to finish
transcoding before publishing.

> ⚠️ The official API makes **how** you post sanctioned. It grants no rights to
> **what** you post. Reposting media you don't own is a copyright/ToS exposure on
> your real account regardless. See [risk-model.md](risk-model.md).

---

## Rate limits that actually shape usage

- **~200 API calls per hour per Instagram account** (reduced from 5,000 in 2025).
  Each target check is exactly **one** request, so that's your ceiling on
  targets × frequency. Widen intervals rather than sweeping everything at once.
- **Publishing:** rolling 24h window keyed to each publish timestamp, not a
  midnight reset — a burst at 09:00 frees up at 09:00 the next day.
