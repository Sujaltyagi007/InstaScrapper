import { prisma } from "@/lib/prisma";

export const R2_LIMITS = {
  // Hard limits (100% of free tier)
  STORAGE_BYTES: 10 * 1024 * 1024 * 1024, // 10 GB
  A_CLASS_OPS: 1_000_000,
  B_CLASS_OPS: 10_000_000,

  // Guardrail Hard Stop (95%)
  HARD_STOP_STORAGE: 9.5 * 1024 * 1024 * 1024, // 9.5 GB
  HARD_STOP_A_CLASS: 950_000,
  HARD_STOP_B_CLASS: 9_500_000,

  // Guardrail Throttle (90%)
  THROTTLE_STORAGE: 9 * 1024 * 1024 * 1024, // 9 GB
  THROTTLE_A_CLASS: 900_000,
  THROTTLE_B_CLASS: 9_000_000,

  // Guardrail Warn (80%)
  WARN_STORAGE: 8 * 1024 * 1024 * 1024, // 8 GB
  WARN_A_CLASS: 800_000,
  WARN_B_CLASS: 8_000_000,
};

export type GuardrailLevel = "NORMAL" | "WARN" | "THROTTLE" | "HARD_STOP";

function getCurrentBillingMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** 
 * Gets the singleton usage counter, initializing or rolling over the month if needed.
 */
export async function getUsageCounters() {
  const currentMonth = getCurrentBillingMonth();

  let counter = await prisma.r2UsageCounter.findUnique({
    where: { id: "singleton" }
  });

  if (!counter) {
    counter = await prisma.r2UsageCounter.create({
      data: { id: "singleton", billingMonth: currentMonth }
    });
  } else if (counter.billingMonth !== currentMonth) {
    // Rollover: reset monthly op counters, keep storage estimate
    counter = await prisma.r2UsageCounter.update({
      where: { id: "singleton" },
      data: {
        billingMonth: currentMonth,
        aClassOps: 0,
        bClassOps: 0,
      }
    });
  }

  return counter;
}

/**
 * Pre-flight check before EVERY upload.
 * Evaluates storage and A-Class limits.
 */
export async function checkBeforeUpload(
  fileSizeBytes: number,
  isEssential: boolean = true
): Promise<{ ok: boolean; reason?: string; level: GuardrailLevel }> {
  const counter = await getUsageCounters();
  
  const projectedStorage = Number(counter.storageBytesEst) + fileSizeBytes;
  const aClass = counter.aClassOps;

  // 1. HARD STOP (95%)
  if (projectedStorage > R2_LIMITS.HARD_STOP_STORAGE) {
    return { ok: false, reason: "Storage hard stop (95% reached)", level: "HARD_STOP" };
  }
  if (aClass > R2_LIMITS.HARD_STOP_A_CLASS) {
    return { ok: false, reason: "A-Class ops hard stop (95% reached)", level: "HARD_STOP" };
  }

  // 2. THROTTLE (90%)
  if (projectedStorage > R2_LIMITS.THROTTLE_STORAGE || aClass > R2_LIMITS.THROTTLE_A_CLASS) {
    if (!isEssential) {
      return { ok: false, reason: "Non-essential upload blocked by throttle (90% reached)", level: "THROTTLE" };
    }
    return { ok: true, level: "THROTTLE" };
  }

  // 3. WARN (80%)
  if (projectedStorage > R2_LIMITS.WARN_STORAGE || aClass > R2_LIMITS.WARN_A_CLASS) {
    return { ok: true, level: "WARN" };
  }

  return { ok: true, level: "NORMAL" };
}

/**
 * Pre-flight check before EVERY direct read (presigned URL or direct GetObject).
 * Evaluates B-Class limits.
 */
export async function checkBeforeRead(): Promise<{ ok: boolean; reason?: string; level: GuardrailLevel }> {
  const counter = await getUsageCounters();
  const bClass = counter.bClassOps;

  // 1. HARD STOP (95%)
  if (bClass > R2_LIMITS.HARD_STOP_B_CLASS) {
    return { ok: false, reason: "B-Class ops hard stop (95% reached)", level: "HARD_STOP" };
  }

  // 2. THROTTLE (90%)
  if (bClass > R2_LIMITS.THROTTLE_B_CLASS) {
    return { ok: false, reason: "Force CDN-only reads (90% B-Class reached)", level: "THROTTLE" };
  }

  // 3. WARN (80%)
  if (bClass > R2_LIMITS.WARN_B_CLASS) {
    return { ok: true, level: "WARN" };
  }

  return { ok: true, level: "NORMAL" };
}

export async function incrementAClass(count: number = 1) {
  try {
    const currentMonth = getCurrentBillingMonth();
    await prisma.r2UsageCounter.updateMany({
      where: { id: "singleton", billingMonth: currentMonth },
      data: { aClassOps: { increment: count } }
    });
  } catch (err) {
    console.error("[R2-Guardrail] Failed to increment A-Class counter", err);
  }
}

export async function incrementBClass(count: number = 1) {
  try {
    const currentMonth = getCurrentBillingMonth();
    await prisma.r2UsageCounter.updateMany({
      where: { id: "singleton", billingMonth: currentMonth },
      data: { bClassOps: { increment: count } }
    });
  } catch (err) {
    console.error("[R2-Guardrail] Failed to increment B-Class counter", err);
  }
}

export async function addStorageEstimate(bytes: number) {
  try {
    await prisma.r2UsageCounter.updateMany({
      where: { id: "singleton" },
      data: { storageBytesEst: { increment: bytes } }
    });
  } catch (err) {
    console.error("[R2-Guardrail] Failed to add storage estimate", err);
  }
}

export async function subtractStorageEstimate(bytes: number) {
  try {
    await prisma.r2UsageCounter.updateMany({
      where: { id: "singleton" },
      data: { storageBytesEst: { decrement: bytes } }
    });
  } catch (err) {
    console.error("[R2-Guardrail] Failed to subtract storage estimate", err);
  }
}

export async function getUsageSummary() {
  const counter = await getUsageCounters();
  
  const storageUsed = Number(counter.storageBytesEst);
  
  return {
    billingMonth: counter.billingMonth,
    storage: {
      usedBytes: storageUsed,
      limitBytes: R2_LIMITS.STORAGE_BYTES,
      percentage: Number(((storageUsed / R2_LIMITS.STORAGE_BYTES) * 100).toFixed(2))
    },
    aClassOps: {
      used: counter.aClassOps,
      limit: R2_LIMITS.A_CLASS_OPS,
      percentage: Number(((counter.aClassOps / R2_LIMITS.A_CLASS_OPS) * 100).toFixed(2))
    },
    bClassOps: {
      used: counter.bClassOps,
      limit: R2_LIMITS.B_CLASS_OPS,
      percentage: Number(((counter.bClassOps / R2_LIMITS.B_CLASS_OPS) * 100).toFixed(2))
    },
    lastReconciledAt: counter.lastReconciledAt,
    status: getOverallStatus(storageUsed, counter.aClassOps, counter.bClassOps)
  };
}

function getOverallStatus(storage: number, aOps: number, bOps: number): GuardrailLevel {
  if (storage > R2_LIMITS.HARD_STOP_STORAGE || aOps > R2_LIMITS.HARD_STOP_A_CLASS || bOps > R2_LIMITS.HARD_STOP_B_CLASS) {
    return "HARD_STOP";
  }
  if (storage > R2_LIMITS.THROTTLE_STORAGE || aOps > R2_LIMITS.THROTTLE_A_CLASS || bOps > R2_LIMITS.THROTTLE_B_CLASS) {
    return "THROTTLE";
  }
  if (storage > R2_LIMITS.WARN_STORAGE || aOps > R2_LIMITS.WARN_A_CLASS || bOps > R2_LIMITS.WARN_B_CLASS) {
    return "WARN";
  }
  return "NORMAL";
}
