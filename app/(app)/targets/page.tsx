import { SWRConfig } from "swr";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { listTargets } from "@/lib/services/target.service";
import { getTargetQuota } from "@/lib/services/quota.service";
import { TARGETS_KEY, TARGET_QUOTA_KEY } from "@/lib/swr-keys";
import { TargetsPageClient } from "@/features/targets/components/targets-page-client";

/**
 * Server Component: fetches the first paint's data directly (no HTTP round
 * trip to our own API) and hands it to SWR as `fallback`, keyed exactly like
 * the client hooks (`TARGETS_KEY`/`TARGET_QUOTA_KEY`) so it's used instead of
 * an extra client fetch. The page arrives already filled in; SWR still owns
 * everything after that (search, optimistic pause/resume/delete, revalidation).
 */
export default async function TargetsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const [targets, quota] = await Promise.all([listTargets(userId), getTargetQuota(userId)]);

  return (
    <SWRConfig
      value={{
        fallback: {
          [TARGETS_KEY]: { targets },
          [TARGET_QUOTA_KEY]: { quota },
        },
      }}
    >
      <TargetsPageClient />
    </SWRConfig>
  );
}
