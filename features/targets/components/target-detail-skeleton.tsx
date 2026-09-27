import { Skeleton } from "@/components/ui/skeleton";
import { CardSkeleton } from "@/components/common/page-skeleton";

/** Same layout as the target detail page: settings + media + events on the left, phone preview on the right. */
export function TargetDetailSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-24" aria-busy="true" aria-label="Loading account">
      <div className="flex flex-col gap-4 lg:col-span-16">
        <div className="flex items-end justify-between gap-3 border-b pb-4">
          <div className="space-y-2">
            <Skeleton className="h-7 w-28 rounded-md" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
        <div className="rounded-xl border bg-card p-4">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-2 h-3 w-64 max-w-full" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center justify-between">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <Skeleton className="h-4 w-32" />
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-lg" />
            ))}
          </div>
        </div>
        <CardSkeleton rows={3} />
      </div>
      <div className="hidden justify-center lg:col-span-8 lg:flex">
        <Skeleton className="h-[560px] w-[280px] rounded-[2.5rem]" />
      </div>
    </div>
  );
}
