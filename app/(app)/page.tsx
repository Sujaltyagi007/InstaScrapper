import { auth } from "@/auth";
import { SWRConfig } from "swr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/features/shell/app-shell";
import { listTargets } from "@/lib/services/target.service";
import { listEventsPage } from "@/lib/services/event.service";
import { getTargetQuota } from "@/lib/services/quota.service";
import { TARGETS_KEY, EVENTS_KEY, TARGET_QUOTA_KEY } from "@/lib/swr-keys";
import { SCREEN_COOKIE, parseScreenPath, type FlashParams, type Screen } from "@/lib/spa/screens";

export default async function AppPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const stored = (await cookies()).get(SCREEN_COOKIE)?.value;
  const parsed = stored ? parseScreenPath(stored) : null;
  const screen: Screen = parsed?.screen ?? { tab: "dashboard" };
  const flash: FlashParams = parsed?.flash ?? {};

  const fallback: Record<string, unknown> = {};
  if (screen.tab === "dashboard") {
    const [targets, eventsPage] = await Promise.all([listTargets(userId), listEventsPage(userId)]);
    fallback[TARGETS_KEY] = { targets };
    fallback[EVENTS_KEY] = eventsPage;
  } else if (screen.tab === "targets" && !screen.view) {
    const [targets, quota] = await Promise.all([listTargets(userId), getTargetQuota(userId)]);
    fallback[TARGETS_KEY] = { targets };
    fallback[TARGET_QUOTA_KEY] = { quota };
  }

  return (
    <SWRConfig value={{ fallback }}>
      <AppShell initialScreen={screen} initialFlash={flash} />
    </SWRConfig>
  );
}
