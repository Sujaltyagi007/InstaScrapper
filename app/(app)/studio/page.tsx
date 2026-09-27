"use client";

import { useState } from "react";
import { LoadingState } from "@/components/common/loading-state";
import { useTargetQuota } from "@/features/account/hooks/use-target-quota";
import { TargetQuotaBanner } from "@/features/account/components/target-quota-banner";
import { useNiche } from "@/features/studio/hooks/use-niche";
import { NicheSetupCard } from "@/features/studio/components/niche-setup-card";
import { NicheAccountsCard } from "@/features/studio/components/niche-accounts-card";
import { IdeasCard } from "@/features/studio/components/ideas-card";
import { ReelsCard } from "@/features/studio/components/reels-card";
import { SoundBankCard } from "@/features/studio/components/sound-bank-card";

export default function StudioPage() {
  const { data, loading, refresh } = useNiche();
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

      {loading || !data ? (
        <LoadingState />
      ) : (
        <>
          <NicheSetupCard key={data.niche?.id ?? "new"} niche={data.niche} onSaved={changed} />
          {data.niche && (
            <>
              <TargetQuotaBanner quota={quota} />
              <NicheAccountsCard data={data} onChanged={changed} />
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
