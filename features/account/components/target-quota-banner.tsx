"use client";
import { AppLink } from "@/features/shell/navigation";
import { AlertTriangle, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TargetQuota } from "../hooks/use-target-quota";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function TargetQuotaBanner({ quota }: { quota: TargetQuota | null }) {
  if (!quota || quota.level === "OK") return null;
  const full = quota.level === "FULL";
  const canRaise = quota.limit < quota.maxLimit;

  if (!full) {
    return (
      <Alert className="border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <AlertTriangle />
        <AlertTitle>
          {quota.used} of {quota.limit} accounts used
        </AlertTitle>
        <AlertDescription className="text-amber-800/90 dark:text-amber-200/80">
          <span>
            {quota.remaining} {quota.remaining === 1 ? "slot" : "slots"} left.
            {canRaise && ` You can raise your limit up to ${quota.maxLimit} in Settings.`}
          </span>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <Ban />
      <AlertTitle>
        Account limit reached ({quota.used} of {quota.limit})
      </AlertTitle>
      <AlertDescription>
        <span>
          {canRaise ? `Raise your limit (up to ${quota.maxLimit}) to add more accounts.` : `${quota.maxLimit} is the maximum. Remove an account to add another.`}
        </span>
        {canRaise && (
          <Button asChild size="sm" variant="outline" className="mt-2 w-fit">
            <AppLink to={{ tab: "settings", section: "monitoring", anchor: "account-limit" }}>Raise limit in Settings</AppLink>
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
