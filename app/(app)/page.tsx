import { SWRConfig } from "swr";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { listTargets } from "@/lib/services/target.service";
import { listEventsPage } from "@/lib/services/event.service";
import { TARGETS_KEY, EVENTS_KEY } from "@/lib/swr-keys";
import { DashboardPageClient } from "@/features/monitoring/components/dashboard-page-client";

/**
 * Server Component: fetches targets + the first page of events directly (no
 * HTTP round trip to our own API) and hands them to SWR as `fallback`. The
 * "mock mode" banner still fetches its own status client-side — that check
 * pulls in the whole scraping-engine mode logic, which isn't worth carrying
 * into every dashboard page-load's server render for one boolean banner.
 */
export default async function DashboardPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const [targets, eventsPage] = await Promise.all([listTargets(userId), listEventsPage(userId)]);

  return (
    <SWRConfig
      value={{
        fallback: {
          [TARGETS_KEY]: { targets },
          [EVENTS_KEY]: eventsPage,
        },
      }}
    >
      <DashboardPageClient />
    </SWRConfig>
  );
}
