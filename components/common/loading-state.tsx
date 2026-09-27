import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface LoadingStateProps {
  /** Screen-reader label; nothing is shown visually. */
  message?: string;
  /** Number of placeholder rows. */
  rows?: number;
  /** Rows with a leading avatar circle (lists of accounts/people). */
  avatar?: boolean;
  className?: string;
}

const WIDTHS = ["w-40", "w-32", "w-48", "w-36", "w-28", "w-44"];

/**
 * Skeleton placeholder for a list of rows. The app never shows a spinner-only
 * "Loading…" screen: this keeps the layout in place until the data arrives.
 */
export function LoadingState({ message = "Loading", rows = 4, avatar = false, className }: LoadingStateProps) {
  return (
    <div role="status" aria-busy="true" aria-label={message} className={cn("divide-y", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-1 py-3">
          {avatar && <Skeleton className="size-8 shrink-0 rounded-full" />}
          <div className="flex-1 space-y-1.5">
            <Skeleton className={cn("h-3.5 max-w-full", WIDTHS[i % WIDTHS.length])} />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      ))}
      <span className="sr-only">{message}</span>
    </div>
  );
}
