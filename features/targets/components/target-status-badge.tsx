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

const DOT_COLOR: Record<NonNullable<BadgeProps["variant"]>, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  destructive: "bg-red-500",
  secondary: "bg-muted-foreground/50",
  outline: "bg-muted-foreground/30",
  default: "bg-primary",
};

export function targetStatusInfo(status: string) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: "outline" as const };
  return { label: config.label, dotClass: DOT_COLOR[config.variant] };
}

function statusTooltip({ nextRunAt, errorMessage }: Omit<TargetStatusBadgeProps, "status">) {
  return (
    errorMessage ||
    (nextRunAt ? `Retrying ${formatDistanceToNow(new Date(nextRunAt), { addSuffix: true })}` : undefined)
  );
}

/** Compact status: a coloured dot plus the label (label hidden with `dotOnly`). */
export function TargetStatusDot({
  status,
  nextRunAt,
  errorMessage,
  dotOnly = false,
  className,
}: TargetStatusBadgeProps & { dotOnly?: boolean; className?: string }) {
  const { label, dotClass } = targetStatusInfo(status);
  const tooltip = statusTooltip({ nextRunAt, errorMessage });
  return (
    <span
      title={tooltip ?? label}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${tooltip ? "cursor-help" : ""} ${className ?? ""}`}
    >
      <span className={`size-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
      {dotOnly ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}

export function TargetStatusBadge({ status, nextRunAt, errorMessage }: TargetStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: "outline" as const };

  const tooltip = statusTooltip({ nextRunAt, errorMessage });

  return (
    <Badge variant={config.variant} title={tooltip} className={tooltip ? "cursor-help" : undefined}>
      {config.label}
    </Badge>
  );
}
