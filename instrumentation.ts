// Dev-only convenience: production scraping is driven by an external scheduler
// hitting /api/cron/monitor. `next dev` never triggers that route, so without
// this, targets never get checked while developing locally.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "development") {
    return;
  }

  const { runDueTargetChecks } = await import("@/lib/services/monitoring.service");
  const POLL_INTERVAL_MS = 60_000;
  let running = false;

  setInterval(() => {
    // Never start a round while the previous one is still going. Before this
    // guard, a 30s timer overlapped multi-minute rounds, and each round
    // grabbed the same due targets — scraping one account several times at
    // once. (Target leases now prevent that too; this avoids the wasted work.)
    if (running) return;
    running = true;
    runDueTargetChecks()
      .then((r) => {
        if (r.checked > 0 || r.stopReason !== "NO_DUE_TARGETS") {
          console.log(`[dev-monitor-poller] checked=${r.checked} stop=${r.stopReason} ${r.elapsedMs}ms`);
        }
      })
      .catch((err) => console.error("[dev-monitor-poller] check failed:", err))
      .finally(() => {
        running = false;
      });
  }, POLL_INTERVAL_MS);

  console.log(`[dev-monitor-poller] human-paced polling every ${POLL_INTERVAL_MS / 1000}s (dev only)`);
}
