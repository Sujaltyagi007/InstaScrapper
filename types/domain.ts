import type {
  Target,
  Monitor,
  Event,
  Media,
  NotificationChannel,
  Job,
  TargetSnapshot,
} from "@prisma/client";

export type TargetWithMonitor = Target & { monitor: Monitor | null; _count?: { events: number } };

export type TargetDetail = Target & {
  monitor: Monitor | null;
  snapshots: TargetSnapshot[];
  events: Event[];
  media: Media[];
};

export type EventWithTarget = Event & { target: { id: string; username: string } };

export type NotificationChannelSummary = Pick<
  NotificationChannel,
  "id" | "name" | "provider" | "eventTypeFilter" | "cooldownSeconds" | "enabled" | "createdAt"
>;

export type JobWithTarget = Job & { target: { username: string } | null };
