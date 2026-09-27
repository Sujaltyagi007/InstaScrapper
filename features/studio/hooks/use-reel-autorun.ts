"use client";

import { useEffect, useRef } from "react";
import { apiFetch } from "@/lib/fetcher";
import type { Reel } from "../lib/reel";

/**
 * While the Studio is open, asks the server to run any reel that's due and idle.
 * The external scheduler (cron-job.org → /api/cron/reels) does this in the
 * background; this keeps reels moving before it's set up, and makes them faster.
 * Each (reel, stage, attempt) is kicked at most once; the server's lease stops doubles.
 */
export function useReelAutorun(reels: Reel[] | null, onKicked: () => void) {
  const kicked = useRef(new Set<string>());

  useEffect(() => {
    for (const reel of reels ?? []) {
      if (!reel.due || reel.running) continue;
      const key = `${reel.id}:${reel.stage}:${reel.attempts}:${reel.nextAttemptAt}`;
      if (kicked.current.has(key)) continue;
      kicked.current.add(key);
      apiFetch<{ started: boolean }>(`/api/reels/${reel.id}/advance`, { method: "POST" })
        .then((res) => {
          if (res.started) setTimeout(onKicked, 1500);
        })
        .catch(() => {});
    }
  }, [reels, onKicked]);
}
