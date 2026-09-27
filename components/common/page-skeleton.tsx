import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingState } from "@/components/common/loading-state";

/** Title + subtitle + action button, matching every page's header. */
export function PageHeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-3.5 w-56 max-w-full" />
      </div>
      {action && <Skeleton className="h-8 w-24 rounded-md" />}
    </div>
  );
}

/** A bordered card with a heading and a few rows. */
export function CardSkeleton({ rows = 3, avatar = false, className }: { rows?: number; avatar?: boolean; className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card p-4", className)}>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-2 h-3 w-48 max-w-full" />
      <LoadingState rows={rows} avatar={avatar} className="mt-2" />
    </div>
  );
}

/** Row of small stat tiles (dashboard, storage). */
export function StatTilesSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="size-4 rounded" />
          </div>
          <Skeleton className="mt-3 h-6 w-12" />
        </div>
      ))}
    </div>
  );
}

/** Whole-page placeholder: header, stat tiles, then a list card. */
export function PageSkeleton({ stats = true, cards = 1 }: { stats?: boolean; cards?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <PageHeaderSkeleton />
      {stats && <StatTilesSkeleton />}
      {Array.from({ length: cards }, (_, i) => (
        <CardSkeleton key={i} rows={4} />
      ))}
    </div>
  );
}
