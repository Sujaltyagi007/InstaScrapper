import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStorageProvider } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Same logic as provider-factory.ts::getProviderMode(), duplicated here on
 * purpose: that module statically imports StealthMetaProvider (the whole
 * scraping engine, incl. the native TLS client) just to report a mode string
 * nothing else in this route needs. This route is polled every 20s by every
 * open tab (system-health-badge.tsx), so it stays free of that weight.
 */
function providerModeLabel(): string {
  const mode = process.env.INSTAGRAM_PROVIDER_MODE?.toUpperCase();
  if (mode === "STEALTH" || mode === "GRAPH" || mode === "MOCK") return mode;
  if (process.env.META_APP_ID && process.env.META_APP_SECRET) return "GRAPH";
  if (process.env.MOCK_META_API === "false") return "STEALTH";
  return "MOCK";
}

export async function GET() {
  const start = Date.now();

  // DB check + latest job, run as one round trip instead of two in sequence.
  const dbStart = Date.now();
  const [dbResult, jobResult] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    prisma.job.findFirst({
      orderBy: { runAt: "desc" },
      select: { runAt: true, status: true, type: true },
    }),
  ]);
  const dbLatencyMs = Date.now() - dbStart;

  const dbStatus: "up" | "down" = dbResult.status === "fulfilled" ? "up" : "down";
  const dbError = dbResult.status === "rejected" ? String(dbResult.reason) : null;

  let lastJobTimestamp: string | null = null;
  let lastJobStatus: string | null = null;
  if (jobResult.status === "fulfilled" && jobResult.value) {
    lastJobTimestamp = jobResult.value.runAt.toISOString();
    lastJobStatus = `${jobResult.value.type}:${jobResult.value.status}`;
  }

  const storageProvider = getStorageProvider();
  const r2Configured = storageProvider !== "none";
  const engineMode = providerModeLabel();

  // Aggregate overall status
  const isHealthy = dbStatus === "up";
  const status = isHealthy ? (r2Configured ? "healthy" : "operational") : "degraded";
  const totalDurationMs = Date.now() - start;

  return NextResponse.json({
    status,
    timestamp: new Date().toISOString(),
    durationMs: totalDurationMs,
    subsystems: {
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
        error: dbError,
      },
      storage: {
        provider: storageProvider,
        status: r2Configured ? "configured" : "fallback_local_or_unconfigured",
        enabled: r2Configured,
      },
      scraperEngine: {
        mode: engineMode,
        status: "ready",
      },
      backgroundWorker: {
        lastJobAt: lastJobTimestamp,
        lastJobStatus,
      },
    },
  }, {
    status: isHealthy ? 200 : 503,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" },
  });
}
