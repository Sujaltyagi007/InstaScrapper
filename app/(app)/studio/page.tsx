"use client";

import { useState } from "react";
import { ErrorState } from "@/components/common/error-state";
import { CardSkeleton } from "@/components/common/page-skeleton";
import { useTargetQuota } from "@/features/account/hooks/use-target-quota";
import { TargetQuotaBanner } from "@/features/account/components/target-quota-banner";
import { useNiche } from "@/features/studio/hooks/use-niche";
import { NicheSetupCard } from "@/features/studio/components/niche-setup-card";
import { NicheAccountsCard } from "@/features/studio/components/niche-accounts-card";
import { ManualMetricsCard } from "@/features/studio/components/manual-metrics-card";
import { IdeasCard } from "@/features/studio/components/ideas-card";
import { ReelsCard } from "@/features/studio/components/reels-card";
import { SoundBankCard } from "@/features/studio/components/sound-bank-card";

export default function StudioPage() {
  const { data, loading, error, refresh } = useNiche();
  const { quota, refresh: refreshQuota } = useTargetQuota();
  const [reelsKey, setReelsKey] = useState(0);

  function changed() {
    refresh();
    refreshQuota();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Studio</h1>
        <p className="text-sm text-muted-foreground">
          Pick your niche and the accounts to learn from. Trend ideas and reels are built from this.
        </p>
      </div>

      {loading && !data ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <CardSkeleton rows={2} />
          <CardSkeleton rows={3} avatar />
          <CardSkeleton rows={3} />
        </div>
      ) : !data ? (
        <ErrorState title="Couldn't load your studio" message={error} onRetry={refresh} />
      ) : (
        <>
          <NicheSetupCard key={data.niche?.id ?? "new"} niche={data.niche} onSaved={changed} />
          {data.niche && (
            <>
              <TargetQuotaBanner quota={quota} />
              <NicheAccountsCard data={data} onChanged={changed} />
              <ManualMetricsCard posts={data.posts} onSaved={refresh} />
              <IdeasCard onApproved={() => setReelsKey((k) => k + 1)} />
              <ReelsCard refreshKey={reelsKey} />
              <SoundBankCard />
            </>
          )}
        </>
      )}
    </div>
  );
}
