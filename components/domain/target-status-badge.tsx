import { Badge } from "@/components/ui/badge";

interface TargetStatusBadgeProps {
  status: string;
}

export function TargetStatusBadge({ status }: TargetStatusBadgeProps) {
  switch (status) {
    case "ACTIVE":
      return <Badge variant="success">Active</Badge>;
    case "PAUSED":
      return <Badge variant="secondary">Paused</Badge>;
    case "AUTH_ERROR":
    case "REAUTH_REQUIRED":
      return <Badge variant="destructive">Auth Error</Badge>;
    case "NOT_FOUND":
    case "UNAVAILABLE":
      return <Badge variant="destructive">Unavailable</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
