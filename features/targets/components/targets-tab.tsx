"use client";

import dynamic from "next/dynamic";
import { Activity } from "react";
import { Pane } from "@/features/shell/pane";
import { CardSkeleton, PageHeaderSkeleton } from "@/components/common/page-skeleton";
import { TargetsPageClient } from "@/features/targets/components/targets-page-client";
import { TargetDetailSkeleton } from "@/features/targets/components/target-detail-skeleton";
import type { Screen } from "@/features/shell/navigation";

// The detail view carries the Instagram simulator; load it only when a target is opened.
const TargetDetailView = dynamic(
  () => import("@/features/targets/components/target-detail-view").then((m) => m.TargetDetailView),
  { loading: () => <TargetDetailSkeleton /> },
);
const AddTargetView = dynamic(
  () => import("@/features/targets/components/add-target-view").then((m) => m.AddTargetView),
  {
    loading: () => (
      <div className="flex flex-col gap-4" aria-busy="true">
        <PageHeaderSkeleton action={false} />
        <CardSkeleton rows={2} />
        <CardSkeleton rows={4} />
      </div>
    ),
  },
);

/** Targets tab: the list stays alive (hidden) while a target or the add form is open. */
export function TargetsTab({ screen }: { screen: Extract<Screen, { tab: "targets" }> }) {
  const view = screen.view;
  return (
    <>
      <Activity mode={view ? "hidden" : "visible"}>
        <Pane>
          <TargetsPageClient />
        </Pane>
      </Activity>
      {view?.kind === "new" && (
        <Pane>
          <AddTargetView />
        </Pane>
      )}
      {view?.kind === "target" && (
        // Keyed: opening another target starts fresh (own scroll, own simulator state).
        <Pane key={view.id}>
          <TargetDetailView id={view.id} />
        </Pane>
      )}
    </>
  );
}
