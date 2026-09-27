import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-helpers";
import { GeminiError } from "@/lib/ai/gemini";
import { mkdtemp, rm } from "node:fs/promises";
import { runVoiceStage } from "@/lib/reels/stages/voice";
import { runAudioStage } from "@/lib/reels/stages/audio";
import { Prisma, type ReelProject } from "@prisma/client";
import { runSafetyStage } from "@/lib/reels/stages/safety";
import { runRenderStage } from "@/lib/reels/stages/render";
import { runScriptStage } from "@/lib/reels/stages/script";
import { runVisualsStage } from "@/lib/reels/stages/visuals";
import { runCaptionStage } from "@/lib/reels/stages/caption";
import { nextStage, type ReelStage } from "@/lib/reels/types";
import { deleteStoredObject, publicDownloadUrl } from "@/lib/storage";
import type { StageContext, StageResult } from "@/lib/reels/stages/context";

const HANDLERS: Partial<Record<ReelStage, (ctx: StageContext) => Promise<StageResult>>> = {
  SCRIPT: runScriptStage,
  VOICE: runVoiceStage,
  AUDIO_PLAN: runAudioStage,
  VISUALS: runVisualsStage,
  SAFETY: runSafetyStage,
  RENDER: runRenderStage,
  CAPTION: runCaptionStage,
};
const RUNNABLE_STAGES = Object.keys(HANDLERS);

const LEASE_MS = 6 * 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 2 * 60_000;
const QUOTA_RETRY_MS = 60 * 60_000;
export const DEFAULT_BUDGET_MS = 250_000;
const STAGE_HEADROOM_MS = 100_000;
const RENDER_HEADROOM_MS = 235_000;
const POSTED_RENDER_KEEP_MS = 3 * 24 * 60 * 60_000;

const FILE_FIELDS = ["voiceFileId", "mixFileId", "renderFileId", "coverFileId"] as const;

function unlocked(now: Date) {
  return { OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] };
}

async function claim(stages: string[], projectId?: string): Promise<ReelProject | null> {
  const now = new Date();
  const due = await prisma.reelProject.findMany({
    where: { ...(projectId ? { id: projectId } : {}), stage: { in: stages }, nextAttemptAt: { lte: now }, ...unlocked(now) },
    orderBy: { nextAttemptAt: "asc" },
    take: 3,
    select: { id: true },
  });
  for (const { id } of due) {
    // Compare-and-set: two overlapping runners can't both take the same project.
    const { count } = await prisma.reelProject.updateMany({
      where: { id, stage: { in: stages }, ...unlocked(now) },
      data: { lockedUntil: new Date(now.getTime() + LEASE_MS) },
    });
    if (count === 1) return prisma.reelProject.findUnique({ where: { id } });
  }
  return null;
}

function userMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

export interface StageRun {
  projectId: string;
  stage: string;
  outcome: "ADVANCED" | "RETRY_LATER" | "WAITING_QUOTA" | "FAILED";
  ms: number;
  error?: string;
}

async function runStage(project: ReelProject): Promise<StageRun> {
  const stage = project.stage as ReelStage;
  const started = Date.now();
  const workDir = await mkdtemp(path.join(os.tmpdir(), `reel-${stage.toLowerCase()}-`));
  const release = { lockedUntil: null };

  try {
    const idea = await prisma.reelIdea.findUnique({ where: { id: project.ideaId }, include: { niche: true } });
    if (!idea) throw new Error("The idea behind this reel was deleted.");
    const result = await HANDLERS[stage]!({ project, idea, workDir });

    await prisma.reelProject.update({
      where: { id: project.id },
      data: { ...result, ...release, stage: nextStage(stage), attempts: 0, error: null, failedStage: null, nextAttemptAt: new Date() },
    });
    // A re-run stage replaces its file; drop the old one only once the new one is saved.
    for (const field of FILE_FIELDS) {
      const old = project[field];
      if (old && typeof result[field] === "string" && result[field] !== old) await deleteStoredObject(old).catch(() => {});
    }
    return { projectId: project.id, stage, outcome: "ADVANCED", ms: Date.now() - started };
  } catch (err) {
    const error = userMessage(err);
    console.error(`[reels] ${stage} failed for ${project.id}:`, error);

    if (err instanceof GeminiError && err.quotaExceeded) {
      await prisma.reelProject.update({
        where: { id: project.id },
        data: {
          ...release,
          error: "Gemini's free daily limit is used up. Retrying every hour.",
          nextAttemptAt: new Date(Date.now() + QUOTA_RETRY_MS),
        },
      });
      return { projectId: project.id, stage, outcome: "WAITING_QUOTA", ms: Date.now() - started, error };
    }
    if (err instanceof GeminiError && err.retryAfterMs !== undefined) {
      // Per-minute limit: not the stage's fault, so it doesn't use up an attempt.
      await prisma.reelProject.update({
        where: { id: project.id },
        data: {
          ...release,
          error: "Gemini's free tier is busy (requests per minute). Retrying shortly.",
          nextAttemptAt: new Date(Date.now() + Math.max(err.retryAfterMs, 60_000)),
        },
      });
      return { projectId: project.id, stage, outcome: "RETRY_LATER", ms: Date.now() - started, error };
    }

    const attempts = project.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await prisma.reelProject.update({
        where: { id: project.id },
        data: { ...release, attempts, error, stage: "FAILED", failedStage: stage },
      });
      return { projectId: project.id, stage, outcome: "FAILED", ms: Date.now() - started, error };
    }
    await prisma.reelProject.update({
      where: { id: project.id },
      data: { ...release, attempts, error, nextAttemptAt: new Date(Date.now() + RETRY_BASE_MS * 2 ** (attempts - 1)) },
    });
    return { projectId: project.id, stage, outcome: "RETRY_LATER", ms: Date.now() - started, error };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Runs due stages one at a time until the time budget runs low. With
 * `projectId`, only that project is advanced (used right after approval).
 */
export async function advanceReelProjects(opts: { projectId?: string; budgetMs?: number } = {}) {
  const started = Date.now();
  const budget = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const runs: StageRun[] = [];
  for (;;) {
    const left = budget - (Date.now() - started);
    if (left < STAGE_HEADROOM_MS) break;
    const stages = left >= RENDER_HEADROOM_MS ? RUNNABLE_STAGES : RUNNABLE_STAGES.filter((st) => st !== "RENDER");
    const project = await claim(stages, opts.projectId);
    if (!project) break;
    runs.push(await runStage(project));
  }
  return { runs, elapsedMs: Date.now() - started };
}

/** Creates the reel project for an approved idea (idempotent). */
export async function createProjectForIdea(userId: string, ideaId: string): Promise<ReelProject> {
  const idea = await prisma.reelIdea.findFirst({ where: { id: ideaId, niche: { userId } }, select: { id: true } });
  if (!idea) throw new ApiError(404, "Idea not found.");
  const existing = await prisma.reelProject.findUnique({ where: { ideaId } });
  if (existing) return existing;
  try {
    return await prisma.reelProject.create({ data: { userId, ideaId } });
  } catch {
    // Lost a race with a double click; the other request created it.
    const raced = await prisma.reelProject.findUnique({ where: { ideaId } });
    if (raced) return raced;
    throw new ApiError(500, "Couldn't create the reel project.");
  }
}

export async function listReelProjects(userId: string, id?: string) {
  const projects = await prisma.reelProject.findMany({
    where: { userId, ...(id ? { id } : {}) },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { idea: { select: { id: true, title: true, hook: true } } },
  });
  const now = Date.now();
  return projects.map((p) => ({
    id: p.id,
    idea: p.idea,
    stage: p.stage,
    failedStage: p.failedStage,
    error: p.error,
    attempts: p.attempts,
    nextAttemptAt: p.nextAttemptAt,
    running: Boolean(p.lockedUntil && p.lockedUntil.getTime() > now),
    // In a working stage, not running, and due now: the open page may kick it (kickReelProject).
    due: RUNNABLE_STAGES.includes(p.stage) && p.nextAttemptAt.getTime() <= now,
    script: p.script,
    voiceTiming: p.voiceTiming,
    audioBlueprint: p.audioBlueprint,
    clips: p.clips,
    voiceUrl: p.voiceUrl,
    mixUrl: p.mixUrl,
    renderUrl: p.renderUrl,
    downloadUrl: p.renderFileId ? (publicDownloadUrl(p.renderFileId) ?? p.renderUrl) : null,
    coverUrl: p.coverUrl,
    caption: p.caption,
    hashtags: p.hashtags,
    scheduledFor: p.scheduledFor,
    sentAt: p.sentAt,
    postedAt: p.postedAt,
    postedUrl: p.postedUrl,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));
}

export async function getReelProject(userId: string, id: string) {
  const [reel] = await listReelProjects(userId, id);
  if (!reel) throw new ApiError(404, "Reel not found.");
  return reel;
}

async function ownProject(userId: string, id: string): Promise<ReelProject> {
  const project = await prisma.reelProject.findFirst({ where: { id, userId } });
  if (!project) throw new ApiError(404, "Reel not found.");
  return project;
}

/** Resumes a failed project from the stage that failed, or runs a backed-off stage now. */
export async function retryReelProject(userId: string, id: string): Promise<void> {
  const project = await ownProject(userId, id);
  if (project.stage === "FAILED") {
    await prisma.reelProject.update({
      where: { id },
      data: { stage: project.failedStage ?? "SCRIPT", failedStage: null, attempts: 0, error: null, nextAttemptAt: new Date() },
    });
    return;
  }
  if (RUNNABLE_STAGES.includes(project.stage)) {
    await prisma.reelProject.update({ where: { id }, data: { nextAttemptAt: new Date() } });
    return;
  }
  throw new ApiError(409, "There's nothing to retry for this reel.");
}

/** Deletes the project and its files; the idea goes back to the suggestions list. */
export async function deleteReelProject(userId: string, id: string): Promise<void> {
  const project = await ownProject(userId, id);
  if (project.lockedUntil && project.lockedUntil > new Date()) {
    throw new ApiError(409, "This reel is being worked on right now. Try again in a minute.");
  }
  for (const field of FILE_FIELDS) {
    const fileId = project[field];
    // Keep the row if a file can't be deleted, so it isn't leaked untracked.
    if (fileId && !(await deleteStoredObject(fileId))) {
      throw new ApiError(502, "Couldn't delete the reel's files from storage. Try again.");
    }
  }
  await prisma.$transaction([
    prisma.reelProject.delete({ where: { id } }),
    prisma.reelIdea.update({ where: { id: project.ideaId }, data: { status: "SUGGESTED" } }),
  ]);
}

/** True when the project is due and nobody is working on it, so the open Studio page may run it now. */
export async function isReelProjectKickable(userId: string, id: string): Promise<boolean> {
  const project = await ownProject(userId, id);
  const now = new Date();
  return (
    RUNNABLE_STAGES.includes(project.stage) &&
    project.nextAttemptAt <= now &&
    !(project.lockedUntil && project.lockedUntil > now)
  );
}

export type RegenerateFrom = "SCRIPT" | "VISUALS" | "CAPTION";

/**
 * Re-runs the pipeline from a stage: a new caption, new footage (search, check,
 * render, caption), or everything. Files are replaced as each stage finishes.
 */
export async function regenerateReelProject(userId: string, id: string, from: RegenerateFrom): Promise<void> {
  const project = await ownProject(userId, id);
  if (project.lockedUntil && project.lockedUntil > new Date()) {
    throw new ApiError(409, "This reel is being worked on right now. Try again in a minute.");
  }
  if (project.stage === "POSTED") throw new ApiError(409, "This reel is already posted.");
  await prisma.reelProject.update({
    where: { id },
    data: {
      stage: from,
      failedStage: null,
      attempts: 0,
      error: null,
      nextAttemptAt: new Date(),
      scheduledFor: null,
      sentAt: null,
      ...(from === "VISUALS" ? { clips: Prisma.DbNull } : {}),
    },
  });
}

export async function markReelPosted(userId: string, id: string, postedUrl?: string): Promise<void> {
  const project = await ownProject(userId, id);
  if (project.stage !== "READY") throw new ApiError(409, "Only a finished reel can be marked as posted.");
  await prisma.reelProject.update({
    where: { id },
    data: { stage: "POSTED", postedAt: new Date(), postedUrl: postedUrl?.trim() || null, scheduledFor: null },
  });
}

/** Deletes the video of reels posted a few days ago; the row, caption and cover stay as history. */
export async function cleanupPostedRenders(): Promise<number> {
  const old = await prisma.reelProject.findMany({
    where: {
      stage: "POSTED",
      postedAt: { lt: new Date(Date.now() - POSTED_RENDER_KEEP_MS) },
      renderFileId: { not: null },
    },
    select: { id: true, renderFileId: true },
    take: 20,
  });
  let cleaned = 0;
  for (const p of old) {
    if (!(await deleteStoredObject(p.renderFileId!))) continue;
    await prisma.reelProject.update({ where: { id: p.id }, data: { renderFileId: null, renderUrl: null } });
    cleaned += 1;
  }
  return cleaned;
}
