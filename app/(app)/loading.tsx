import { PageSkeleton } from "@/components/common/page-skeleton";

/** Shown instantly on navigation while a server-rendered page fetches its data. */
export default function Loading() {
  return <PageSkeleton />;
}
