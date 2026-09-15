import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  className?: string;
  action?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  className,
  action,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center", className)}>
      {Icon && (
        <div className="flex size-12 items-center justify-center rounded-full bg-muted mb-3">
          <Icon className="size-6 text-muted-foreground" />
        </div>
      )}
      <h3 className="font-semibold text-base">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>
      {action && <div className="mt-4">{action}</div>}
      {!action && actionLabel && onAction && (
        <div className="mt-4">
          <Button onClick={onAction} size="sm">
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
