import { Badge } from "@/components/ui/badge";

interface EventTypeBadgeProps {
  type: string;
}

export function EventTypeBadge({ type }: EventTypeBadgeProps) {
  const formatted = type.replace(/_/g, " ");

  switch (type) {
    case "FOLLOWERS_INCREASE":
    case "NEW_POST":
    case "NEW_STORY":
    case "NEW_REEL":
      return <Badge variant="success">{formatted}</Badge>;
    case "FOLLOWERS_DECREASE":
    case "POST_DELETED":
    case "REEL_DELETED":
      return <Badge variant="destructive">{formatted}</Badge>;
    case "BIO_CHANGED":
    case "USERNAME_CHANGED":
    case "NAME_CHANGED":
      return <Badge variant="secondary">{formatted}</Badge>;
    default:
      return <Badge variant="outline">{formatted}</Badge>;
  }
}
