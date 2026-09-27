import type { Niche, Prisma, ReelIdea, ReelProject } from "@prisma/client";

export interface StageContext {
  project: ReelProject;
  idea: ReelIdea & { niche: Niche };
  /** Fresh temp directory for this stage run; deleted afterwards. ffmpeg runs with it as cwd. */
  workDir: string;
}

/** Fields a stage sets on the project. The pipeline adds the stage change itself. */
export type StageResult = Omit<Prisma.ReelProjectUpdateInput, "stage" | "user" | "idea">;
