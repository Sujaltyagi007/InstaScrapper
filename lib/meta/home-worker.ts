import crypto from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * Home worker: lets a burner's requests be executed by a small script running
 * on the user's own PC (worker/home-worker.mjs) instead of from this server.
 * The server never talks to the worker directly — it drops a job row, the
 * worker polls for it, executes the raw HTTP request itself (its own IP, its
 * own TLS stack) and posts the result back. See docs/home-worker-setup.md and
 * the "Home worker" section of brain.md.
 *
 * This module owns device-token issuance/verification and the job
 * create-then-poll flow. It knows nothing about Instagram — requestPayload is
 * an opaque {method, url, headers, body} the caller (stealth-engine-bridge.ts)
 * already assembled exactly as it would for the direct-from-server path.
 */

const JOB_TTL_MS = 90_000;
const POLL_INTERVAL_MS = 700;

export interface HomeWorkerRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HomeWorkerResponse {
  status: number;
  text: string;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** A new device token, shown to the user once. Only its hash is ever stored. */
export function generateDeviceToken(): string {
  return `hw_${crypto.randomBytes(32).toString("base64url")}`;
}

export async function pairDevice(userId: string, label: string): Promise<{ id: string; token: string }> {
  const token = generateDeviceToken();
  const device = await prisma.homeWorkerDevice.create({
    data: { userId, label: label.trim() || "Home worker", tokenHash: hashToken(token), status: "ACTIVE" },
  });
  return { id: device.id, token };
}

/** Resolves a device from its bearer token, touching lastSeenAt. Null if unknown/revoked. */
export async function authenticateDevice(token: string | null): Promise<{ id: string; userId: string } | null> {
  if (!token) return null;
  const device = await prisma.homeWorkerDevice.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, status: true },
  });
  if (!device || device.status !== "ACTIVE") return null;
  await prisma.homeWorkerDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return { id: device.id, userId: device.userId };
}

export class HomeWorkerUnavailableError extends Error {}

/**
 * Creates a job for the session's paired device and waits (short DB polls,
 * bounded by the caller's own deadline) for the worker to post a result.
 * Throws HomeWorkerUnavailableError — never PROXY_AUTH_FAILED-style errors —
 * when the worker never claims or answers the job, so callers treat an
 * offline PC as a temporary failure (BACKOFF), not a flagged session.
 */
export async function executeViaHomeWorker(
  deviceId: string,
  sessionId: string,
  request: HomeWorkerRequest,
  deadlineAt?: number,
): Promise<HomeWorkerResponse> {
  const now = Date.now();
  const budgetMs = deadlineAt ? Math.max(1000, Math.min(JOB_TTL_MS, deadlineAt - now - 2000)) : JOB_TTL_MS;
  const expiresAt = new Date(now + budgetMs);

  const job = await prisma.homeWorkerJob.create({
    data: {
      deviceId,
      sessionId,
      status: "PENDING",
      requestPayload: request as unknown as object,
      expiresAt,
    },
  });

  const pollUntil = now + budgetMs;
  while (Date.now() < pollUntil) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const row = await prisma.homeWorkerJob.findUnique({
      where: { id: job.id },
      select: { status: true, responsePayload: true },
    });
    if (!row) break;
    if (row.status === "DONE" && row.responsePayload) {
      const payload = row.responsePayload as unknown as HomeWorkerResponse;
      return { status: payload.status, text: payload.text };
    }
    if (row.status === "FAILED" || row.status === "EXPIRED") {
      throw new HomeWorkerUnavailableError(
        row.status === "EXPIRED" ? "No paired device claimed this request in time." : "The paired device reported a failure.",
      );
    }
  }

  // Unclaimed/unfinished when our budget ran out — mark it so the worker
  // doesn't act on a stale job a moment later, then report a plain timeout.
  await prisma.homeWorkerJob
    .updateMany({ where: { id: job.id, status: { in: ["PENDING", "CLAIMED"] } }, data: { status: "EXPIRED" } })
    .catch(() => {});
  throw new HomeWorkerUnavailableError("The paired device did not answer in time.");
}
