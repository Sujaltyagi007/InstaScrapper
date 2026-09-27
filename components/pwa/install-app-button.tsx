"use client";

import { useState, useSyncExternalStore } from "react";
import { Download, PlusSquare, Share } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { installStore, isIos, isStandalone, promptInstall } from "@/lib/pwa/client";

const noopSubscribe = () => () => {};

/**
 * "Install app" row for the sidebar. Chrome/Edge/Android: opens the browser's
 * install dialog. iPhone/iPad (no install API): shows the Add to Home Screen
 * steps. Hidden when already installed or when the browser can't install.
 */
export function InstallAppButton({ className }: { className?: string }) {
  const { prompt, installed } = useSyncExternalStore(
    installStore.subscribe,
    installStore.getSnapshot,
    installStore.getServerSnapshot,
  );
  const standalone = useSyncExternalStore(noopSubscribe, isStandalone, () => true);
  const ios = useSyncExternalStore(noopSubscribe, isIos, () => false);
  const [iosHelp, setIosHelp] = useState(false);

  if (standalone || installed) return null;
  if (!prompt && !ios) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => (prompt ? promptInstall() : setIosHelp(true))}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          className,
        )}
      >
        <Download className="size-4" />
        <span>Install app</span>
      </button>

      <Dialog open={iosHelp} onOpenChange={setIosHelp}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Install IG Monitor</DialogTitle>
            <DialogDescription>
              Add it to your Home Screen to open it like an app and get notifications on iPhone and iPad.
            </DialogDescription>
          </DialogHeader>
          <ol className="flex flex-col gap-3 text-sm">
            <Step n={1}>
              Tap <Share className="mx-1 inline size-4 align-text-bottom" /> <b>Share</b> in the browser toolbar.
            </Step>
            <Step n={2}>
              Choose <PlusSquare className="mx-1 inline size-4 align-text-bottom" /> <b>Add to Home Screen</b>.
            </Step>
            <Step n={3}>
              Tap <b>Add</b>, then open IG Monitor from your Home Screen.
            </Step>
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{n}</span>
      <span className="leading-5">{children}</span>
    </li>
  );
}
