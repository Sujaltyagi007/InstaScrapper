import type { Niche, Prisma, ReelIdea, ReelProject } from "@prisma/client";

export interface StageContext {
  project: ReelProject;
  idea: ReelIdea & { niche: Niche };
  workDir: string;
}

export type StageResult = Omit<Prisma.ReelProjectUpdateInput, "stage" | "user" | "idea">;
