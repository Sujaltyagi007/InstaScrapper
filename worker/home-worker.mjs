#!/usr/bin/env node
// home-worker: runs on your own PC and executes Instagram requests for one
// paired burner session, so they leave from your home IP instead of the
// app's Webshare proxy. See ../docs/home-worker-setup.md before running this.
//
// No inbound port, no tunnel: this script only ever makes OUTBOUND requests
// to your app (polling for work) and to Instagram (executing that work).
//
// Configure via environment variables or a .env file next to this script:
//   APP_URL       e.g. https://your-app.vercel.app
//   DEVICE_TOKEN  the token shown once when you paired this device in Settings
//
// Run:  node home-worker.mjs   (needs Node 18+ for global fetch)

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnvIfPresent(join(HERE, ".env"));

const APP_URL = (process.env.APP_URL || "").replace(/\/+$/, "");
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || "";

if (!APP_URL || !DEVICE_TOKEN) {
  console.error("Set APP_URL and DEVICE_TOKEN (env vars or a .env file next to this script). See docs/home-worker-setup.md.");
  process.exit(1);
}

const POLL_ERROR_BACKOFF_MS = 5000;

console.log(`[home-worker] starting, polling ${APP_URL}`);

async function main() {
  for (;;) {
    try {
      const job = await pollForJob();
      if (job) {
        await runJob(job);
      }
      // No sleep on success: the poll endpoint itself is a long poll (~25s),
      // so calling again immediately is the normal idle state, not a busy loop.
    } catch (err) {
      console.error("[home-worker] poll failed, retrying:", err?.message || err);
      await sleep(POLL_ERROR_BACKOFF_MS);
    }
  }
}

async function pollForJob() {
  const res = await fetch(`${APP_URL}/api/worker/jobs/next`, {
    headers: { Authorization: `Bearer ${DEVICE_TOKEN}` },
  });
  if (res.status === 401) {
    console.error("[home-worker] device token was rejected (revoked?). Pair a new device and update DEVICE_TOKEN.");
    process.exit(1);
  }
  if (!res.ok) throw new Error(`GET /jobs/next -> HTTP ${res.status}`);
  const body = await res.json();
  return body.job || null;
}

async function runJob(job) {
  const { id, request } = job;
  console.log(`[home-worker] job ${id}: ${request.method} ${request.url}`);
  let result;
  try {
    // Plain Node fetch: it carries whatever headers/cookies the server built
    // (the same ones it would have sent itself), so the request content is
    // identical — only the IP and the low-level TLS handshake differ from
    // what the server's own curl_cffi-impersonated client would send. That's
    // an accepted trade-off for v1 (see docs/home-worker-setup.md).
    const res = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.method === "POST" ? request.body : undefined,
    });
    const text = await res.text();
    result = { status: res.status, text };
  } catch (err) {
    await postResult(id, { error: err?.message || String(err) });
    console.error(`[home-worker] job ${id} failed:`, err?.message || err);
    return;
  }
  const ack = await postResult(id, result);
  console.log(`[home-worker] job ${id}: HTTP ${result.status} (${result.text.length} bytes)${ack.ok ? "" : ` — ${ack.reason || "not accepted"}`}`);
}

async function postResult(id, payload) {
  const res = await fetch(`${APP_URL}/api/worker/jobs/${id}/result`, {
    method: "POST",
    headers: { Authorization: `Bearer ${DEVICE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  return res.json().catch(() => ({ ok: true }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadDotEnvIfPresent(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] === undefined) {
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

main();
