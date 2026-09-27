import { Skeleton } from "@/components/ui/skeleton";

// Name widths vary a little so the placeholder doesn't look like a grid.
const NAME_WIDTHS = ["w-28", "w-36", "w-24", "w-32", "w-40", "w-28"];

/** Same shape as the targets list (mobile rows / laptop table) while it loads. */
export function TargetsListSkeleton({ rows = 6 }: { rows?: number }) {
  const items = Array.from({ length: rows }, (_, i) => NAME_WIDTHS[i % NAME_WIDTHS.length]);
  return (
    <div className="overflow-hidden rounded-xl border bg-card" aria-busy="true" aria-label="Loading targets">
      {/* Mobile */}
      <div className="md:hidden">
        <div className="flex h-9 items-center gap-3 border-b bg-muted/40 px-3">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className="h-3 w-20" />
        </div>
        <ul className="divide-y">
          {items.map((w, i) => (
            <li key={i} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="size-4 rounded-sm" />
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className={`h-3.5 ${w}`} />
                <Skeleton className="h-3 w-48 max-w-full" />
              </div>
              <Skeleton className="size-6 rounded-md" />
            </li>
          ))}
        </ul>
      </div>

      {/* Laptop */}
      <div className="hidden md:block">
        <div className="flex h-9 items-center gap-4 border-b bg-muted/40 pl-4 pr-3">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className="h-2.5 w-16" />
        </div>
        <div className="divide-y">
          {items.map((w, i) => (
            <div key={i} className="flex h-12 items-center gap-4 pl-4 pr-3">
              <Skeleton className="size-4 rounded-sm" />
              <div className="flex flex-1 items-center gap-2.5">
                <Skeleton className="size-8 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className={`h-3.5 ${w}`} />
                  <Skeleton className="h-2.5 w-24" />
                </div>
              </div>
              <Skeleton className="h-3 w-16" />
              <Skeleton className="hidden h-3 w-20 lg:block" />
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3 w-6" />
              <Skeleton className="size-6 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
