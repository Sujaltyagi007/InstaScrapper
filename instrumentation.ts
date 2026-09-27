export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "development") {
    return;
  }

  const { runDueTargetChecks } = await import("@/lib/services/monitoring.service");
  const POLL_INTERVAL_MS = 60_000;
  let running = false;

  setInterval(() => {
    if (running) return;
    running = true;
    runDueTargetChecks().then((r) => {
      if (r.checked > 0 || r.stopReason !== "NO_DUE_TARGETS") {
        console.log(`[dev-monitor-poller] checked=${r.checked} stop=${r.stopReason} ${r.elapsedMs}ms`);
      }
    }).catch((err) => console.error("[dev-monitor-poller] check failed:", err)).finally(() => { running = false; });
  }, POLL_INTERVAL_MS);

  console.log(`[dev-monitor-poller] human-paced polling every ${POLL_INTERVAL_MS / 1000}s (dev only)`);

  // Same idea for reel projects, which production advances via /api/cron/reels.
  const { advanceReelProjects } = await import("@/lib/services/reel-pipeline.service");
  const { sendDueReels } = await import("@/lib/services/reel-delivery.service");
  let reelsRunning = false;
  setInterval(() => {
    if (reelsRunning) return;
    reelsRunning = true;
    sendDueReels().then(() => advanceReelProjects())
      .then((r) => {
        if (r.runs.length > 0) console.log(`[dev-reels-poller] ${r.runs.map((x) => `${x.stage}:${x.outcome}`).join(" ")}`);
      }).catch((err) => console.error("[dev-reels-poller] failed:", err))
      .finally(() => {
        reelsRunning = false;
      });
  }, POLL_INTERVAL_MS);
}
