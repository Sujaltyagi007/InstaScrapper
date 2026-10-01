"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  ExternalLink,
  Search,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ClaimsReport } from "@/lib/reels/quality/claims";
import type { QualityReport } from "@/lib/reels/quality/score";
import { friendlyError } from "@/lib/friendly-error";

interface ClaimsCardProps {
  reelId: string;
  report: ClaimsReport;
  onUpdate: (claimsReport: ClaimsReport, qualityReport?: QualityReport) => void;
}

export function ClaimsCard({ reelId, report, onUpdate }: ClaimsCardProps) {
  const [busy, setBusy] = useState<number | null>(null);

  if (report.claims.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-emerald-600" />
            <CardTitle className="text-base">Factual claims</CardTitle>
          </div>
          <CardDescription>
            No verifiable factual claims found in the script. Nothing to sign off.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const signed = Object.keys(report.signedOff).length;
  const total = report.claims.length;

  async function toggle(index: number) {
    const isCurrentlySigned = index in report.signedOff;
    setBusy(index);
    try {
      const res = (await apiFetch(`/api/reels/${reelId}/claims`, {
        method: "PATCH",
        body: JSON.stringify({ claimIndex: index, signedOff: !isCurrentlySigned }),
      })) as { claimsReport: ClaimsReport; qualityReport?: QualityReport };
      onUpdate(res.claimsReport, res.qualityReport);
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't update the claim."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {report.allSignedOff ? (
              <ShieldCheck className="size-5 text-emerald-600" />
            ) : (
              <ShieldAlert className="size-5 text-amber-500" />
            )}
            <CardTitle className="text-base">Factual claims</CardTitle>
          </div>
          <span className="text-sm tabular-nums text-muted-foreground">
            {signed}/{total} signed off
          </span>
        </div>
        <CardDescription>
          {report.allSignedOff
            ? "Every claim has been reviewed."
            : "Check each fact before posting. A wrong claim is the biggest risk the scorer can't catch."}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {report.claims.map((claim, i) => {
          const done = i in report.signedOff;
          const loading = busy === i;
          return (
            <div key={i} className={`group relative flex gap-3 rounded-lg border p-3 transition-colors ${done
              ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20"
              : "border-amber-200 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20"
              }`}
            >
              <button
                type="button"
                className="mt-0.5 shrink-0 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-full"
                onClick={() => toggle(i)}
                disabled={loading}
                aria-label={done ? `Undo sign-off for claim ${i + 1}` : `Sign off claim ${i + 1}`}
              >
                {done ? (
                  <CheckCircle2 className="size-5 text-emerald-600" />
                ) : (
                  <Circle className="size-5 text-muted-foreground" />
                )}
              </button>

              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <p className="text-sm font-medium leading-snug">{claim.claim}</p>
                <p className="text-xs italic text-muted-foreground">&ldquo;{claim.quote}&rdquo;</p>
                <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-500" />
                  <span>{claim.risk}</span>
                </div>
                {claim.checkWith && claim.checkWith !== "common knowledge" && (
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(claim.checkWith)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline w-fit"
                  >
                    <Search className="size-3" />
                    Verify: {claim.checkWith}
                    <ExternalLink className="size-2.5" />
                  </a>
                )}
                {done && report.signedOff[i]?.note && (
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">
                    <Check className="mr-1 inline size-3" />
                    {report.signedOff[i].note}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
