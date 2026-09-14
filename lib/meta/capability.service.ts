import type { TargetEligibility, TargetAccountType } from "@prisma/client";
import type { TargetResolution, ResolvedAccountType, TargetEligibilityResult } from "./types";

const ACCOUNT_TYPE_MAP: Record<ResolvedAccountType, TargetAccountType> = {
  BUSINESS: "BUSINESS",
  CREATOR: "CREATOR",
  PERSONAL: "PERSONAL",
  UNKNOWN: "UNKNOWN",
};

const ELIGIBILITY_MAP: Record<TargetEligibilityResult, TargetEligibility> = {
  SUPPORTED: "SUPPORTED",
  PARTIALLY_SUPPORTED: "PARTIALLY_SUPPORTED",
  UNSUPPORTED: "UNSUPPORTED",
  PRIVATE_UNAVAILABLE: "PRIVATE_UNAVAILABLE",
  TEMPORARILY_UNAVAILABLE: "TEMPORARILY_UNAVAILABLE",
};

export function toPrismaAccountType(type: ResolvedAccountType): TargetAccountType {
  return ACCOUNT_TYPE_MAP[type];
}

export function toPrismaEligibility(result: TargetEligibilityResult): TargetEligibility {
  return ELIGIBILITY_MAP[result];
}

/** Human-readable one-liner for the UI, matching the plan's failure-case copy. */
export function eligibilityMessage(resolution: TargetResolution): string {
  switch (resolution.eligibility) {
    case "SUPPORTED":
      return "This account is fully supported for monitoring.";
    case "PARTIALLY_SUPPORTED":
      return "This account can be monitored, but only for the capabilities marked available below.";
    case "UNSUPPORTED":
      return "This account cannot be monitored through the supported API.";
    case "PRIVATE_UNAVAILABLE":
      return "This account is private. Monitoring cannot bypass privacy settings.";
    case "TEMPORARILY_UNAVAILABLE":
      return "This account is temporarily unavailable. Try resolving again shortly.";
    default:
      return "Unable to determine monitoring support for this account.";
  }
}

export function isMonitorable(resolution: TargetResolution): boolean {
  return resolution.eligibility === "SUPPORTED" || resolution.eligibility === "PARTIALLY_SUPPORTED";
}
