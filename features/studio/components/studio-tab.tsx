"use client";

import dynamic from "next/dynamic";
import { Activity } from "react";
import { Pane } from "@/features/shell/pane";
import { Skeleton } from "@/components/ui/skeleton";
import { CardSkeleton } from "@/components/common/page-skeleton";
import { StudioView } from "@/features/studio/components/studio-view";
import type { Screen } from "@/features/shell/navigation";

const ReelReviewView = dynamic(
  () => import("@/features/studio/components/reel-review-view").then((m) => m.ReelReviewView),
  {
    loading: () => (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4" aria-busy="true">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-7 w-2/3" />
        <CardSkeleton rows={4} />
      </div>
    ),
  },
);

/** Studio tab: the studio stays alive (hidden) while a reel is open. */
export function StudioTab({ screen }: { screen: Extract<Screen, { tab: "studio" }> }) {
  return (
    <>
      <Activity mode={screen.reelId ? "hidden" : "visible"}>
        <Pane>
          <StudioView />
        </Pane>
      </Activity>
      {screen.reelId && (
        <Pane key={screen.reelId}>
          <ReelReviewView id={screen.reelId} />
        </Pane>
      )}
    </>
  );
}
