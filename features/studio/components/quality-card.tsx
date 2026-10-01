"use client";

import { Check, Minus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dimension, QualityReport } from "@/lib/reels/quality/score";

const DIMENSION_LABELS: Record<Dimension, string> = {
  hook: "Hook",
  retention: "Keeps attention",
  visual: "Picture",
  audio: "Sound",
  readability: "Captions",
  originality: "Originality",
};

const VERDICTS: Record<QualityReport["verdict"], { label: string; hint: string }> = {
  READY: { label: "Ready to review", hint: "Scores 80 or above." },
  FIXABLE: { label: "Could be better", hint: "Between 65 and 79. Look at the weak spots below." },
  WEAK: { label: "Weak", hint: "Under 65. Consider a rewrite or new footage." },
  BLOCKED: { label: "Blocked", hint: "A required check failed. Fix it before posting." },
};

function barColor(score: number) {
  return score >= 0.8 ? "bg-emerald-500" : score >= 0.6 ? "bg-amber-500" : "bg-red-500";
}

export function QualityCard({ report }: { report: QualityReport }) {
  const verdict = VERDICTS[report.verdict];
  const dimensions = (Object.keys(DIMENSION_LABELS) as Dimension[]).filter((d) => report.dimensions[d]);
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Quality score</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={report.verdict === "READY" ? "default" : "secondary"}>{verdict.label}</Badge>
            <span className="text-2xl font-semibold tabular-nums">{report.score}</span>
          </div>
        </div>
        <CardDescription>{verdict.hint}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <ul className="flex flex-col gap-2">
          {dimensions.map((d) => {
            const dim = report.dimensions[d];
            return (
              <li key={d} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-2">
                <span className="text-muted-foreground">{DIMENSION_LABELS[d]}</span>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  {dim.score !== null && (
                    <div className={`h-full ${barColor(dim.score)}`} style={{ width: `${Math.round(dim.score * 100)}%` }} />
                  )}
                </div>
                <span className="text-right tabular-nums text-xs text-muted-foreground">
                  {dim.score === null ? "n/a" : Math.round(dim.score * 100)}
                </span>
              </li>
            );
          })}
        </ul>

        <ul className="flex flex-col gap-1.5">
          {report.gates.map((g) => (
            <li key={g.id} className="flex items-start gap-2">
              {g.passed === true ? (
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              ) : g.passed === false ? (
                <X className="mt-0.5 size-4 shrink-0 text-red-600" />
              ) : (
                <Minus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <span>
                {g.label}
                <span className="block text-xs text-muted-foreground">{g.detail}</span>
              </span>
            </li>
          ))}
        </ul>

        {report.failing.length > 0 && (
          <div>
            <p className="mb-1 font-medium">Weak spots</p>
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {report.failing.slice(0, 5).map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
