"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Media, TargetSnapshot } from "@prisma/client";
import { ChevronRight, Image as ImageIcon, UserSquare } from "lucide-react";
import { InstagramSimulator } from "./instagram-simulator";
import { displayThumbnail } from "../hooks/use-media-actions";
import { useSimulatorLayer } from "../hooks/use-simulator-layer";

interface SimulatorSheetProps {
  snapshot?: TargetSnapshot | null;
  media: Media[];
  username: string;
  targetId: string;
  onDataChanged?: () => void;
}

/**
 * Phone/tablet entry to the simulator: a compact card that opens it full-screen at once
 * (the data is already loaded, so there's nothing to wait for). The phone tab bar stays
 * on top of it. Back — the button or the phone's own — closes a post, then the view.
 */
export function SimulatorSheet(props: SimulatorSheetProps) {
  const { snapshot, media, username } = props;
  const layer = useSimulatorLayer();
  const { back } = layer;
  const open = layer.depth > 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, back]);

  const profilePic = snapshot?.profilePictureStorageUrl || snapshot?.profilePictureUrl || "";
  const previews = media.slice(0, 3);
  const postsCount = snapshot?.mediaCount ?? media.length;
  const followers = snapshot?.followersCount;

  return (
    <>
      <button
        type="button"
        onClick={layer.open}
        className="group flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left shadow-xs transition-[transform,background-color] duration-150 active:scale-[0.98] active:bg-muted/60"
      >
        <span className="size-11 shrink-0 rounded-full bg-linear-to-tr from-yellow-400 via-red-500 to-fuchsia-600 p-0.5">
          <span className="flex size-full items-center justify-center overflow-hidden rounded-full border-2 border-background bg-muted">
            {profilePic ? (
              <img src={profilePic} alt="" className="size-full object-cover" />
            ) : (
              <UserSquare className="size-5 text-muted-foreground" />
            )}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Instagram view</span>
          <span className="block truncate text-xs text-muted-foreground">
            {postsCount.toLocaleString()} posts
            {followers != null && <> · {compact(followers)} followers</>}
          </span>
        </span>
        {previews.length > 0 && (
          <span className="flex shrink-0 -space-x-2" aria-hidden>
            {previews.map((item) => {
              const url = displayThumbnail(item);
              return (
                <span key={item.id} className="size-8 overflow-hidden rounded-md border-2 border-card bg-muted">
                  {url ? (
                    <img src={url} alt="" className="size-full object-cover" loading="lazy" />
                  ) : (
                    <ImageIcon className="m-1.5 size-4 text-muted-foreground" />
                  )}
                </span>
              );
            })}
          </span>
        )}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-active:translate-x-0.5" />
      </button>

      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`@${username} as it looks on Instagram`}
            onClick={(e) => {
              if (e.target === e.currentTarget) back();
            }}
            // Below the phone tab bar (z-45), above the app header (z-40).
            className="fixed inset-0 z-42 flex flex-col bg-background pt-[env(safe-area-inset-top)] duration-200 animate-in fade-in-0 slide-in-from-bottom-6 motion-reduce:animate-none md:bg-black/60 md:p-6 md:backdrop-blur-sm lg:hidden"
          >
            <div className="h-full min-h-0 md:mx-auto md:w-full md:max-w-sm md:overflow-hidden md:rounded-2xl md:border md:shadow-2xl">
              <InstagramSimulator {...props} fullscreen onClose={back} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function compact(n: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
