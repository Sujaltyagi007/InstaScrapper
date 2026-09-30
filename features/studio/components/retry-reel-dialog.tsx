"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STAGE_LABELS, type Reel } from "../lib/reel";

export function RetryReelDialog({
  reel,
  open,
  onOpenChange,
  onConfirm,
}: {
  reel: Reel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const stage = reel ? (reel.stage === "FAILED" ? reel.failedStage ?? "SCRIPT" : reel.stage) : "SCRIPT";
  const stageLabel = STAGE_LABELS[stage] ?? stage;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retry this reel?</DialogTitle>
          <DialogDescription>
            It will resume at <span className="font-medium text-foreground">{stageLabel}</span>. Generation services may be called again; nothing will be published to Instagram.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onConfirm}>
            <RotateCcw /> Start retry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}