// Dev-only convenience: production scraping is driven by Vercel Cron hitting
// /api/cron/monitor (see vercel.json). `next dev` never triggers that route,
// so without this, targets never get checked while developing locally.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "development") {
    return;
  }

  const { runDueTargetChecks } = await import("@/lib/services/monitoring.service");
  const POLL_INTERVAL_MS = 30_000;

  setInterval(() => {
    runDueTargetChecks(20).catch((err) => {
      console.error("[dev-monitor-poller] check failed:", err);
    });
  }, POLL_INTERVAL_MS);

  console.log(`[dev-monitor-poller] polling due targets every ${POLL_INTERVAL_MS / 1000}s (dev only)`);
}
