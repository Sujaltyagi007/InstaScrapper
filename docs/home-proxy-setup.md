# Home-internet exit (your own residential IP)

Route the app's Instagram traffic out through **your home internet**, so Meta sees a
genuine residential ISP IP instead of a flagged datacenter one. This is the cheapest
"genuine IP" option — it costs roughly nothing beyond the internet you already pay for.

**No app code changes.** The app already sends every request through a proxy URL
(`InstagramSession.proxyUrl`, or the global `DEFAULT_PROXY_URL`). You just point that
at a proxy running on your home network.

---

## Why it can't be a plain VPN

The app runs on **Vercel (serverless)**. A serverless function can't hold a persistent
WireGuard/OpenVPN connection. So the shape is:

```
Vercel app  ──HTTP proxy──►  a reachable endpoint  ──►  proxy running at home  ──►  Instagram
                                                                                (egress = your home IP)
```

You run a small **HTTP proxy at home**, expose it at a **reachable address**, and paste
that address into the app. Two ways to expose it — pick one.

---

## What you need

- A device at home that stays on: a **Raspberry Pi, an old laptop, or your desktop**.
- ~10 minutes.

---

## Step 1 — Run an authenticated HTTP proxy at home

Easiest is [`gost`](https://github.com/go-gost/gost) (single binary, all platforms).
Download it, then run **one** authenticated HTTP proxy on port 8080:

```bash
# Linux / macOS / Raspberry Pi
./gost -L "http://MYUSER:MYPASS@:8080"

# Windows (PowerShell)
.\gost.exe -L "http://MYUSER:MYPASS@:8080"
```

- Replace `MYUSER` / `MYPASS` with a username and a strong password **you invent**.
- Keep this running (see Step 4 to make it permanent).

> The `MYUSER:MYPASS` auth is mandatory — the endpoint will be publicly reachable, and
> without auth anyone could use your home connection.

Test it locally first:

```bash
curl --proxy "http://MYUSER:MYPASS@127.0.0.1:8080" https://api.ipify.org
# → should print YOUR home IP address
```

---

## Step 2 — Expose it at a reachable address

### Option A (simplest): ngrok TCP tunnel

1. Install [ngrok](https://ngrok.com/download), sign up (free), run `ngrok config add-authtoken <token>`.
2. Expose the proxy port:
   ```bash
   ngrok tcp 8080
   ```
3. ngrok prints something like `tcp://7.tcp.eu.ngrok.io:14523`. That host+port is your
   reachable endpoint.

**Trade-off:** on the free plan the address **changes every restart** (you'd re-paste it),
and there are bandwidth limits. Fine to try it out; for always-on use, Option B.

### Option B (stable): a $4/mo VPS as the front door

Run the proxy at home but make a cheap VPS the public entry, tunneling back through home:

1. Get a tiny VPS (Hetzner/DigitalOcean/etc., the smallest tier).
2. On the **home** device, open a reverse tunnel to the VPS so the VPS can reach the
   home proxy:
   ```bash
   # forwards VPS:8080 → home:8080 over SSH, and keeps retrying
   ssh -N -R 8080:127.0.0.1:8080 root@YOUR_VPS_IP
   ```
   (Use `autossh` to keep it alive across drops.)
3. On the **VPS**, run `gost` pointing at the tunnelled port so it's an authed proxy the
   world can reach but that egresses via home:
   ```bash
   ./gost -L "http://MYUSER:MYPASS@:9090" -F "http://127.0.0.1:8080"
   ```
4. Your reachable endpoint is `YOUR_VPS_IP:9090`, and it exits from your home IP.

The VPS never touches Instagram itself — it's only a stable doorway. Egress stays residential.

---

## Step 3 — Put the address into the app

Assemble the proxy URL:

```
http://MYUSER:MYPASS@<endpoint-host>:<endpoint-port>
```

e.g. `http://MYUSER:MYPASS@7.tcp.eu.ngrok.io:14523` (ngrok) or
`http://MYUSER:MYPASS@YOUR_VPS_IP:9090` (VPS).

Use it in **one** of these places:

- **Per account (recommended):** Settings → the account's session → **Proxy URL** field.
  This pins that account to your home IP — the right way to keep one IP per account.
- **Global fallback:** set `DEFAULT_PROXY_URL` in `.env` locally, and in **Vercel →
  Project → Settings → Environment Variables** for production. Redeploy after changing it.

Verify from the app: add/test a session on that proxy, or run a target check — it should
succeed, and requests now leave from your home IP.

---

## Step 4 — Keep it running

- **Linux (Pi/server):** wrap `gost` in a `systemd` service so it restarts on boot.
- **Windows:** run it via Task Scheduler "at startup", or NSSM as a service.
- Use **`autossh`** (not plain `ssh`) for the Option B reverse tunnel so it reconnects.

---

## Honest limits

- **Uptime = your home's uptime.** If home internet or the device drops, checks fail until
  it's back (the app just retries later — nothing breaks).
- **Throughput = your home upload speed.** Fine for monitoring (tiny requests) and the
  occasional repost; not for heavy fleets.
- **You're exposing activity on your home IP.** Keep it to a few accounts you own. It does
  **not** make you invisible — it makes the IP genuinely residential, which is the single
  biggest anti-flag factor, but pacing/volume still matter (already handled in-app).
- **One IP ↔ one account.** If you run several accounts, give each its own residential IP
  (its own home exit or its own paid residential proxy). Sharing one IP across many
  accounts is itself a flag.

---

## TL;DR

1. `gost -L "http://user:pass@:8080"` on a home device.
2. Expose it: `ngrok tcp 8080` (quick) or a VPS reverse tunnel (stable).
3. Paste `http://user:pass@<endpoint>` into the account's **Proxy URL** in Settings.
4. Instagram now sees your real home IP. No app code changed.
