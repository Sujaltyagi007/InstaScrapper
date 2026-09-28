# Home worker (run a burner's requests from your own PC)

Lets one burner Instagram session's logged-in requests execute on your own PC — your
home IP, your machine — instead of through the app's Webshare proxy. Unlike
[home-proxy-setup.md](home-proxy-setup.md), this needs **no tunnel, no VPS, no open
port**: the worker script only ever makes outbound requests (to your app, then to
Instagram), the same shape as `instagram_monitor.py` running on your own machine.

---

## How it works

```
Vercel app                         Your PC (worker/home-worker.mjs)
   │                                        │
   │  1. drops a job in the DB              │
   │  2. worker polls for it ───────────────┤  polls GET /api/worker/jobs/next
   │  3. worker executes the request ───────┼──►  Instagram   (egress = your home IP)
   │  4. worker posts the result back ──────┤
   └── check continues with that result ────┘
```

Nothing about the burner's daily cap, cooldown, or flag handling changes — only
*where* its request physically leaves from. See `lib/meta/home-worker.ts` and the
"Home worker" section of `brain.md`.

---

## ⚠️ Read before pairing a device

- **One device per burner.** Pairing a second session to a device already pinned to
  another one is refused — sharing one home IP across two burners is itself a flag,
  the same reason `proxy-identity.ts` refuses a shared Webshare IP.
- **This ties the burner to your home IP and PC.** If you also open Instagram on your
  own phone signed into this burner, that's the strongest link there is between it
  and your real account — the same warning as importing a session from your own
  browser. Keep the burner off your personal devices.
- **The worker must be running whenever that burner's checks are due**, or the check
  simply times out and backs off (same as an offline proxy) — it never gets marked
  FLAGGED just for being offline.

---

## Setup

1. **Settings → Instagram sessions → Home worker → Pair device.** Give it a label
   (e.g. "My desktop"). You'll see `APP_URL` and a one-time `DEVICE_TOKEN` — copy
   both now, the token is never shown again.
2. On the PC that should make this burner's requests: copy the `worker/` folder from
   this repo (or just `home-worker.mjs` + `package.json`), create a `.env` file next
   to `home-worker.mjs`:
   ```
   APP_URL=https://your-app.vercel.app
   DEVICE_TOKEN=hw_...
   ```
3. Run it (Node 18+ required, for global `fetch`):
   ```bash
   cd worker
   node home-worker.mjs
   ```
   You should see `[home-worker] starting, polling ...`.
4. Back in Settings, on the burner session's row, switch its transport dropdown from
   **Webshare proxy** to the device you paired. Its badge changes to "Home worker".
5. Trigger a check (Run check now, or wait for the schedule) and watch the worker's
   console — you should see a job claimed and its HTTP status logged.

## Keeping it running

- **Windows:** Task Scheduler → "Run at startup" → `node C:\path\to\home-worker.mjs`.
- **Linux/Pi:** wrap it in a `systemd` service so it restarts on boot/crash.
- If the worker stops, that burner's checks fall back to `BACKOFF` (temporary
  failure, retried later) until it's back online or you switch the session back to
  **Webshare proxy** in Settings.

## Revoking a device

Settings → Home worker → the trash icon next to a device. Any session pinned to it is
switched back to **Webshare proxy** automatically, so it never gets stranded with no
worker able to claim its jobs.

## Known limitation (v1)

The worker sends the request with Node's own `fetch`/TLS stack, not the same
browser-TLS impersonation (`curl_cffi`/`@dryft/tlsclient`) the server uses for the
proxy path. The request *content* (headers, cookies, endpoint) is identical either
way — only the low-level TLS handshake fingerprint differs from what Vercel would
have sent. Matching it exactly (bundling the native TLS client into the worker too)
is a possible future improvement, not done yet.
