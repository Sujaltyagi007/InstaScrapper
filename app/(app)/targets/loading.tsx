import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/components/common/page-skeleton";
import { TargetsListSkeleton } from "@/features/targets/components/targets-list-skeleton";

/** Same shape as the Targets page, shown instantly while the server fetches the list. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <PageHeaderSkeleton />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Skeleton className="h-8 w-full sm:w-64" />
        <div className="flex gap-1.5">
          <Skeleton className="h-7 w-12 rounded-full" />
          <Skeleton className="h-7 w-16 rounded-full" />
          <Skeleton className="h-7 w-16 rounded-full" />
          <Skeleton className="h-7 w-28 rounded-full" />
        </div>
      </div>
      <TargetsListSkeleton />
    </div>
  );
}
