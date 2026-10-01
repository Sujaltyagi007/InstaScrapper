import path from "node:path";
import { Prisma } from "@prisma/client";
import { evaluateRender } from "@/lib/reels/quality/evaluate";
import { extractClaims } from "@/lib/reels/quality/claims";
import { captionCues } from "@/lib/render/timing";
import { readFile, writeFile } from "node:fs/promises";
import { buildAssSubtitles } from "@/lib/render/captions";
import type { StageContext, StageResult } from "./context";
import { runFfmpeg, stageFonts } from "@/lib/render/ffmpeg";
import { fetchPublicToFile } from "@/lib/security/fetch-public";
import { START_FRACTION, downloadHeaders } from "@/lib/visuals/types";
import { parseDurationSec } from "@/lib/render/mix";
import { downloadStoredObject, uploadBuffer } from "@/lib/storage";
import { buildReelRenderArgs, segmentsForSentences, splitIntoShots } from "@/lib/render/reel";
import type { AudioBlueprint, ClipPick, ReelScript, VoiceTiming } from "@/lib/reels/types";

const CLIP_MAX_BYTES = 150 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 3;
const RENDER_TIMEOUT_MS = 220_000;

async function inBatches<T>(items: T[], size: number, run: (item: T, index: number) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map((item, j) => run(item, i + j)));
  }
}

export async function runRenderStage({ project, idea, workDir }: StageContext): Promise<StageResult> {
  const script = project.script as ReelScript | null;
  const timing = project.voiceTiming as VoiceTiming | null;
  const blueprint = project.audioBlueprint as AudioBlueprint | null;
  const picks = project.clips as unknown as ClipPick[] | null;
  if (!script || !timing || !blueprint || !picks?.length || !project.mixFileId) {
    throw new Error("The project is missing its script, audio or footage.");
  }
  if (picks.some((p) => !p.approved)) throw new Error("Some footage hasn't passed the safety check.");

  const mix = await downloadStoredObject(project.mixFileId);
  if (!mix) throw new Error("Couldn't read the mixed audio from storage.");
  await writeFile(path.join(workDir, "mix.m4a"), mix);

  const ordered = [...picks].sort((a, b) => a.sentence - b.sentence);
  await inBatches(ordered, DOWNLOAD_CONCURRENCY, async (pick, i) => {
    await fetchPublicToFile(pick.chosen.url, path.join(workDir, `clip${i}.mp4`), {
      maxBytes: CLIP_MAX_BYTES,
      timeoutMs: 60_000,
      headers: downloadHeaders(pick.chosen.source ?? "pexels"),
    });
  });

  // NASA, Wikimedia and Europeana don't report a length, so read each clip's real one.
  const lengths = await Promise.all(
    ordered.map(async (pick, i) => {
      try {
        const { stderr } = await runFfmpeg(["-i", `clip${i}.mp4`, "-t", "0.1", "-f", "null", "-"], {
          cwd: workDir,
          timeoutMs: 20_000,
        });
        return parseDurationSec(stderr) ?? pick.chosen.durationSec;
      } catch {
        return pick.chosen.durationSec;
      }
    }),
  );

  const bpm = blueprint.music?.bpm;
  const segments = segmentsForSentences(timing.spans, blueprint.durationSec, bpm ? 60 / bpm : null);
  const fontsDir = await stageFonts(workDir);
  const sentences = script.sentences.map((s) => s.text);
  const cues = captionCues(sentences, timing.spans);
  await writeFile(path.join(workDir, "captions.ass"), buildAssSubtitles(cues));

  await runFfmpeg(
    buildReelRenderArgs({
      clips: ordered.map((p, i) => {
        const fraction = START_FRACTION[p.chosen.source ?? "pexels"];
        return {
          file: `clip${i}.mp4`,
          durationSec: lengths[i],
          startSec: fraction === undefined ? undefined : fraction * lengths[i],
        };
      }),
      segments,
      audioFile: "mix.m4a",
      assFile: "captions.ass",
      fontsDir,
      outFile: "reel.mp4",
    }),
    { cwd: workDir, timeoutMs: RENDER_TIMEOUT_MS },
  );
  // Cover: a frame just after the hook starts, for the review page and the phone push.
  await runFfmpeg(["-ss", "1.2", "-i", "reel.mp4", "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "4", "cover.jpg"], {
    cwd: workDir,
    timeoutMs: 20_000,
  });

  // Scoring and claim extraction are advice for the reviewer; a failure must never lose a finished render.
  const [report, claimsReport] = await Promise.all([
    evaluateRender({
      projectId: project.id,
      userId: project.userId,
      workDir,
      file: "reel.mp4",
      script,
      picks: ordered,
      spans: timing.spans,
      segments: splitIntoShots(segments),
      cues,
      durationSec: blueprint.durationSec,
    }).catch((err) => {
      console.error(`[reels] quality scoring failed for ${project.id}:`, err);
      return null;
    }),
    extractClaims(script).catch((err) => {
      console.error(`[reels] claim extraction failed for ${project.id}:`, err);
      return null;
    }),
  ]);

  // Patch the claims gate into the quality report so the reviewer sees it.
  if (report && claimsReport) {
    const gate = report.gates.find((g) => g.id === "claims-signed-off");
    if (gate) {
      if (claimsReport.claims.length === 0) {
        gate.passed = true;
        gate.detail = "No verifiable factual claims found in the script.";
      } else {
        gate.passed = false;
        gate.detail = `${claimsReport.claims.length} claim(s) need sign-off before posting.`;
      }
    }
  }

  const folder = `reels/${project.id}`;
  const video = await uploadBuffer({
    buffer: await readFile(path.join(workDir, "reel.mp4")),
    fileName: "reel.mp4",
    folder,
    contentType: "video/mp4",
    owner: { userId: project.userId, kind: "REEL", label: `Reel "${idea.title}": video` },
  });
  if (!video) throw new Error("Couldn't store the rendered reel. Is storage configured?");
  const cover = await uploadBuffer({
    buffer: await readFile(path.join(workDir, "cover.jpg")),
    fileName: "cover.jpg",
    folder,
    contentType: "image/jpeg",
    owner: { userId: project.userId, kind: "REEL", label: `Reel "${idea.title}": cover` },
  });

  return {
    renderUrl: video.url,
    renderFileId: video.fileId,
    coverUrl: cover?.url ?? null,
    coverFileId: cover?.fileId ?? null,
    qualityScore: report?.score ?? null,
    qualityReport: report ? (report as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    claimsReport: claimsReport ? (claimsReport as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
  };
}
