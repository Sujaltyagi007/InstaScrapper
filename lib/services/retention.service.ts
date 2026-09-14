import { prisma } from "@/lib/prisma";

const JOB_HISTORY_RETENTION_DAYS = 30; // system-level, independent of per-user retention

/**
 * Deletes event/notification/snapshot history older than each user's
 * configured retentionDays (Settings page), plus old job-run history used
 * for observability. Media rows (used for new-post dedupe) are intentionally
 * never purged here, since removing them could cause an old post to be
 * re-detected as "new" and re-notified.
 */
export async function runRetentionCleanup() {
  const users = await prisma.user.findMany({ select: { id: true, retentionDays: true } });
  let eventsDeleted = 0;
  let snapshotsDeleted = 0;

  for (const user of users) {
    const cutoff = new Date(Date.now() - user.retentionDays * 24 * 60 * 60 * 1000);

    const events = await prisma.event.deleteMany({
      where: { userId: user.id, detectedAt: { lt: cutoff } },
    });
    eventsDeleted += events.count;

    const snapshots = await prisma.targetSnapshot.deleteMany({
      where: { target: { userId: user.id }, capturedAt: { lt: cutoff } },
    });
    snapshotsDeleted += snapshots.count;
  }

  const jobCutoff = new Date(Date.now() - JOB_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const jobs = await prisma.job.deleteMany({
    where: { finishedAt: { lt: jobCutoff }, status: { in: ["SUCCEEDED", "FAILED"] } },
  });

  return { eventsDeleted, snapshotsDeleted, jobsDeleted: jobs.count };
}
