import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isImageKitEnabled } from "@/lib/storage/imagekit";
import { getProviderMode } from "@/lib/meta/provider-factory";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();

  // 1. Database check with latency timing
  let dbStatus: "up" | "down" = "down";
  let dbLatencyMs = 0;
  let dbError: string | null = null;

  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
    dbStatus = "up";
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  // 2. ImageKit storage status
  const imageKitConfigured = isImageKitEnabled();

  // 3. Instagram Scraper Engine Mode
  const engineMode = getProviderMode();

  // 4. Latest background job / worker activity
  let lastJobTimestamp: string | null = null;
  let lastJobStatus: string | null = null;
  try {
    const lastJob = await prisma.job.findFirst({
      orderBy: { runAt: "desc" },
      select: { runAt: true, status: true, type: true },
    });
    if (lastJob) {
      lastJobTimestamp = lastJob.runAt.toISOString();
      lastJobStatus = `${lastJob.type}:${lastJob.status}`;
    }
  } catch { }

  // Aggregate overall status
  const isHealthy = dbStatus === "up";
  const status = isHealthy ? (imageKitConfigured ? "healthy" : "operational") : "degraded";
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
        provider: "imagekit.io",
        status: imageKitConfigured ? "configured" : "fallback_local_or_unconfigured",
        enabled: imageKitConfigured,
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
