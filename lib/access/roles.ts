export interface TargetLimitPolicy {
  defaultLimit: number;
  maxLimit: number;
  minLimit: number;
  warnRatio: number;
}

export interface RolePolicy {
  targets: TargetLimitPolicy;
}

const ROLE_POLICIES = {
  USER: { targets: { defaultLimit: 10, maxLimit: 50, minLimit: 1, warnRatio: 0.8 }, },
} satisfies Record<string, RolePolicy>;

export type UserRole = keyof typeof ROLE_POLICIES;

export const DEFAULT_ROLE: UserRole = "USER";

export function policyFor(role: string | null | undefined): RolePolicy {
  return (ROLE_POLICIES as Record<string, RolePolicy>)[role ?? ""] ?? ROLE_POLICIES[DEFAULT_ROLE];
}

export function isKnownRole(role: string): role is UserRole {
  return role in ROLE_POLICIES;
}
