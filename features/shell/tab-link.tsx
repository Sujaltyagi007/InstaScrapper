"use client";

import type { ComponentProps } from "react";
import { screenToPath } from "@/lib/spa/screens";
import { openTab, useNavState, type AppTab, type Screen } from "@/features/shell/navigation";
import { prefetchTab } from "@/features/shell/tab-registry";

/**
 * A main-navigation link to a tab. A plain click switches in place (to where the
 * tab was left; tapping the open tab returns to its start). Hover, focus or the
 * first touch already loads the tab's code and data.
 */
export function TabLink({ tab, onClick, ...props }: Omit<ComponentProps<"a">, "href"> & { tab: AppTab }) {
  const { screen } = useNavState();
  const warm = () => prefetchTab(tab, screen);
  return (
    <a
      href={screenToPath({ tab } as Screen)}
      aria-current={screen.tab === tab ? "page" : undefined}
      onPointerEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        openTab(tab);
      }}
      {...props}
    />
  );
}
