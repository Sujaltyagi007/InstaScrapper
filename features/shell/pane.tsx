"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * One screen's scroll area. Every tab (and every view inside a tab) gets its own,
 * so switching away and back keeps its scroll position instead of sharing one
 * scroll bar. Same padding/width as the old page <main>.
 *
 * Hiding with <Activity> applies display:none, which resets scroll offsets, so
 * the offsets of this pane and anything scrollable inside it are recorded while
 * scrolling and put back when the pane is shown again (layout effects re-run then).
 */
export function Pane({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const offsets = useRef(new Map<Element, number>());

  useLayoutEffect(() => {
    for (const [el, top] of offsets.current) {
      if (el.isConnected) el.scrollTop = top;
      else offsets.current.delete(el);
    }
  }, []);

  return (
    <div
      ref={ref}
      // Scroll events don't bubble, but they do pass through the capture phase.
      onScrollCapture={(e) => {
        const el = e.target as Element;
        if (el === ref.current || ref.current?.contains(el)) offsets.current.set(el, el.scrollTop);
      }}
      className="absolute inset-0 flex flex-col overflow-y-auto p-3 sm:p-6"
    >
      <div className="mx-auto flex w-full max-w-6xl min-h-0 flex-1 flex-col">
        {children}
        {/* Room for the phone tab bar (padding on the scroller isn't counted in its height). */}
        <div aria-hidden className="h-[calc(5rem+env(safe-area-inset-bottom))] shrink-0 md:hidden" />
      </div>
    </div>
  );
}
