"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/common/loading-state";
import { useTargetQuota, type TargetQuota } from "../hooks/use-target-quota";
import { TargetQuotaBanner } from "./target-quota-banner";

/**
 * Self-service control for how many accounts the user may monitor. The
 * min/max shown come from the server's role policy, never hardcoded here, so
 * a future role with different bounds needs no UI change.
 */
export function TargetLimitCard() {
  const { quota, loading, updateLimit } = useTargetQuota();

  return (
    <Card id="account-limit" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>Monitored account limit</CardTitle>
        <CardDescription>
          How many Instagram accounts you can monitor. Every account counts, including paused and
          unsupported ones.
        </CardDescription>
      </CardHeader>
      {loading || !quota ? (
        <CardContent>
          <LoadingState />
        </CardContent>
      ) : (
        // Keyed on the saved limit so the input resets to the server value
        // after each successful save.
        <LimitForm key={quota.limit} quota={quota} onSave={updateLimit} />
      )}
    </Card>
  );
}

function LimitForm({
  quota,
  onSave,
}: {
  quota: TargetQuota;
  onSave: (limit: number) => Promise<TargetQuota>;
}) {
  const [value, setValue] = useState(String(quota.limit));
  const [saving, setSaving] = useState(false);

  const parsed = Number(value);
  const lowest = Math.max(quota.minLimit, quota.used);
  const valid = Number.isInteger(parsed) && parsed >= lowest && parsed <= quota.maxLimit;
  const unchanged = parsed === quota.limit;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || unchanged) return;
    setSaving(true);
    try {
      const next = await onSave(parsed);
      toast.success(`Account limit set to ${next.limit}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update limit.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      <CardContent className="flex flex-col gap-4">
        <TargetQuotaBanner quota={quota} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="max-targets">Maximum accounts</Label>
          <Input
            id="max-targets"
            type="number"
            inputMode="numeric"
            min={lowest}
            max={quota.maxLimit}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="max-w-32"
          />
          <p className="text-xs text-muted-foreground">
            Using {quota.used} of {quota.limit}. You can set between {lowest} and {quota.maxLimit}
            {quota.used > quota.minLimit && " (not below the number you already monitor)"}. Default is{" "}
            {quota.defaultLimit}.
          </p>
          {!valid && value !== "" && (
            <p className="text-xs text-destructive">
              {parsed < quota.used
                ? `You're monitoring ${quota.used} accounts. Remove some before lowering the limit below that.`
                : `Enter a whole number between ${lowest} and ${quota.maxLimit}.`}
            </p>
          )}
        </div>
      </CardContent>
      <CardFooter>
        <Button type="submit" disabled={saving || !valid || unchanged}>
          {saving && <Loader2 className="animate-spin" />}
          Save limit
        </Button>
      </CardFooter>
    </form>
  );
}
