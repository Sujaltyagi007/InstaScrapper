import { SWRConfig } from "swr";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { listTargets } from "@/lib/services/target.service";
import { getTargetQuota } from "@/lib/services/quota.service";
import { TARGETS_KEY, TARGET_QUOTA_KEY } from "@/lib/swr-keys";
import { TargetsPageClient } from "@/features/targets/components/targets-page-client";

export default async function TargetsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const [targets, quota] = await Promise.all([listTargets(userId), getTargetQuota(userId)]);

  return (
    <SWRConfig value={{ fallback: { [TARGETS_KEY]: { targets }, [TARGET_QUOTA_KEY]: { quota }, }, }}    >
      <TargetsPageClient />
    </SWRConfig>
  );
}
  