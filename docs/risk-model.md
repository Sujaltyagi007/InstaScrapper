# Risk model — where the ban/account risk actually lives

Read this before assuming "official API + good scraping = safe." Both of those help, but
they solve **different** problems, and one real risk survives both. This doc is the honest
map of what's dangerous, to which account, and why.

The app does two separate jobs with two separate risk profiles:

1. **Monitor other people's accounts** (scraping) — runs on burner sessions / anonymous.
2. **Repost media to your own account** (publishing) — runs on an account you own.

Treat them as two systems that must never share an identity. See
[home-proxy-setup.md](home-proxy-setup.md) for the IP side of that separation.

---

## 1. Scraping half — risk lands on burners + IP, never your real account

Scraping never touches your real account. It uses the burner **session pool**
(`lib/meta/session-pool.ts`) or the anonymous HTML path. So the exposure is:

- **Burner accounts get challenged / flagged.** This is expected and normal. The pool is
  *designed* to absorb it: a flagged session goes `FLAGGED`, rotation moves to another, and
  you reset it later after solving the checkpoint in a real browser. Losing a burner is a
  running cost, not a failure state.
- **The residential IP can get soft-blocked or rate-limited** (the login-shell soft block,
  429s). That's a **throughput / reliability** problem, not a ban. Pacing and a genuinely
  residential IP lower it but never eliminate it — the login-shell rate is mostly an
  IP-freshness property, not something fixable in code.
- **Your real account is not exposed by scraping at all.** Correct, and worth protecting:
  it stays true only as long as the real account never shares infrastructure with a burner
  (see §4).

**Net:** scraping risk = burner churn + IP heat. Not your real account.

---

## 2. Posting half via official Graph API — sanctioned, but not zero risk

Moving reposting to the official **Graph Content Publishing API** removes the ban risk *for
the automation mechanism itself* — Meta will not ban you for "posting from a server" when
you use the sanctioned path. But the official API does **not** launder these:

- **Rate / volume caps.** Content publishing is capped (historically ~25 posts / 24h per
  account). Not a ban — a ceiling. Bulk reposting hits it.
- **Token / app fragility.** Access tokens expire and must be refreshed. If the app or the
  connected Business account trips a policy check, publishing simply stops.
- **The Page / Business account still must follow Community Guidelines.** Spammy or bulk
  reposting can get the **Page or Business account restricted** even through the official
  API.

**Net:** the API choice fixes *how* you post. It does nothing about *what* you post.

---

## 3. The main glitch — reposting other people's content (neither fix removes this)

You are republishing media you don't own. That is a **content / copyright / ToS** issue at
the *product* level, not the API level:

- The official API does **not** grant any right to repost media you don't own. A DMCA
  takedown, or a "posting content that isn't yours" strike, hits your **real account**
  regardless of how cleanly the bytes were uploaded.
- At volume, reposting third-party content is exactly the pattern Meta's automated systems
  flag — official API or not.

This is the residual risk, and it's the real one. **The API choice changes the transport,
not the content policy.**

**How to collapse it to near zero:**
- Repost **your own** content, or content you have explicit rights to.
- Keep **volume human** — don't bulk-republish.
- Keep the real account on its **own clean IP**.

---

## 4. Correlation — keep the two halves fully separate

If the same infrastructure touches both the burner scraping pool **and** your real
Graph-connected account, Meta can link them, and a flagged burner can pull your real
account into scrutiny.

- **Never let the real account share an IP with a burner.** The app already supports
  per-account proxy pinning (`InstagramSession.proxyUrl`) — the discipline is to actually
  use a distinct clean IP for the real account.
- Avoid sharing **device identity, payment method, or phone number** across a burner and
  the real account.
- The real account's Graph connection lives in `MetaConnection` (encrypted token); the
  burner cookies live in `InstagramSession`. Keeping them in separate models is deliberate —
  keep them separate in practice too.

---

## Summary table

| Layer | Ban risk after both halves are "solved" |
| --- | --- |
| Scraping your targets | On **burners / IP** only — expected, absorbed by the pool. Real account untouched. |
| Posting via Graph API | Low for the *mechanism*; bounded by rate limits + token/app fragility. |
| **Reposting others' content** | **Unchanged and real** — copyright / ToS strikes hit your real account no matter how you post. |
| Correlation | Real if burners and the real account share IP / device / identity — **keep them separate.** |

**Bottom line:** flawless scraping protects your real account; the official API makes
posting sanctioned; but **what you repost** is the risk neither one touches. Repost content
you have rights to, at human volume, on a clean IP, and the last real risk drops to near
zero.
