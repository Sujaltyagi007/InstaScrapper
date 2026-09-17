export interface Actor {
  id: string;
  role: string;
}

export type Permission = "targetLimit.update" | "targetLimit.read";

export function can(actor: Actor, permission: Permission, subjectUserId: string): boolean {
  switch (permission) {
    case "targetLimit.read":
    case "targetLimit.update": return actor.id === subjectUserId;
    default: return false;
  }
}
