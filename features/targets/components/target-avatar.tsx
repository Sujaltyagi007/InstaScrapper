"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

const TONES = [
  "from-rose-500 to-orange-400",
  "from-violet-500 to-fuchsia-400",
  "from-sky-500 to-cyan-400",
  "from-emerald-500 to-teal-400",
  "from-amber-500 to-yellow-400",
  "from-indigo-500 to-blue-400",
];

function toneFor(username: string) {
  let h = 0;
  for (const ch of username) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

export function TargetAvatar({ username, src, className, children, }: { username: string; src?: string | null; className?: string; children?: React.ReactNode; }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const initials = username.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
  return (
    <span className={cn("relative inline-flex size-8 shrink-0", className)}>
      <span aria-hidden className={cn("flex size-full items-center justify-center rounded-full bg-linear-to-br text-[0.65rem] font-semibold text-white",
        toneFor(username),)}      >
        {initials}
      </span>
      {src && !failed && (
        <img src={src} alt="" loading="lazy" decoding="async"
          onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
          className={cn("absolute inset-0 size-full rounded-full object-cover ring-1 ring-border transition-opacity duration-200",
            loaded ? "opacity-100" : "opacity-0",)} />
      )}
      {children}
    </span>
  );
}
