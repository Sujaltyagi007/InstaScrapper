import { Badge, type BadgeProps } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

interface TargetStatusBadgeProps {
  status: string;
  nextRunAt?: string | Date | null;
  errorMessage?: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; variant: NonNullable<BadgeProps["variant"]> }> = {
  ACTIVE: { label: "Active", variant: "success" },
  PAUSED: { label: "Paused", variant: "secondary" },
  DISCOVERED: { label: "Discovered", variant: "outline" },
  RATE_LIMITED: { label: "Rate limited", variant: "warning" },
  BACKOFF: { label: "Backing off", variant: "warning" },
  AUTH_ERROR: { label: "Auth error", variant: "destructive" },
  REAUTH_REQUIRED: { label: "Reauth required", variant: "destructive" },
  NOT_FOUND: { label: "Not found", variant: "destructive" },
  UNAVAILABLE: { label: "Unavailable", variant: "destructive" },
  UNSUPPORTED: { label: "Unsupported", variant: "outline" },
  INVALID: { label: "Invalid", variant: "destructive" },
};

export function TargetStatusBadge({ status, nextRunAt, errorMessage }: TargetStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: "outline" as const };

  const tooltip =
    errorMessage ||
    (nextRunAt ? `Retrying ${formatDistanceToNow(new Date(nextRunAt), { addSuffix: true })}` : undefined);

  return (
    <Badge variant={config.variant} title={tooltip} className={tooltip ? "cursor-help" : undefined}>
      {config.label}
    </Badge>
  );
}
