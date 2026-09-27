import type { AudioBlueprint, ClipPick, ReelScript, VoiceTiming } from "@/lib/reels/types";

/** A reel project as returned by /api/reels. */
export interface Reel {
  id: string;
  idea: { id: string; title: string; hook: string };
  stage: string;
  failedStage: string | null;
  error: string | null;
  attempts: number;
  nextAttemptAt: string;
  running: boolean;
  due: boolean;
  script: ReelScript | null;
  voiceTiming: VoiceTiming | null;
  audioBlueprint: AudioBlueprint | null;
  clips: ClipPick[] | null;
  voiceUrl: string | null;
  mixUrl: string | null;
  renderUrl: string | null;
  downloadUrl: string | null;
  coverUrl: string | null;
  caption: string | null;
  hashtags: string[];
  scheduledFor: string | null;
  sentAt: string | null;
  postedAt: string | null;
  postedUrl: string | null;
  createdAt: string;
}

export const PIPELINE_STEPS: { stage: string; label: string }[] = [
  { stage: "SCRIPT", label: "Script" },
  { stage: "VOICE", label: "Voice" },
  { stage: "AUDIO_PLAN", label: "Music & mix" },
  { stage: "VISUALS", label: "Footage" },
  { stage: "SAFETY", label: "Safety check" },
  { stage: "RENDER", label: "Render" },
  { stage: "CAPTION", label: "Caption" },
];

export const STAGE_LABELS: Record<string, string> = {
  SCRIPT: "Writing script",
  VOICE: "Recording voice",
  AUDIO_PLAN: "Mixing audio",
  VISUALS: "Finding footage",
  SAFETY: "Checking footage",
  RENDER: "Rendering video",
  CAPTION: "Writing caption",
  READY: "Ready",
  POSTED: "Posted",
  FAILED: "Failed",
};

export const ACTIVE_STAGES = new Set(PIPELINE_STEPS.map((s) => s.stage));

export function fullCaption(reel: Pick<Reel, "caption" | "hashtags">): string {
  return [reel.caption ?? "", reel.hashtags.join(" ")].filter(Boolean).join("\n\n");
}
