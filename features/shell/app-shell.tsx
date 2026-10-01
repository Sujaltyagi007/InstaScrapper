"use client";

import { Activity, useEffect } from "react";
import { Menu, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { APP_TABS, type FlashParams } from "@/lib/spa/screens";
import { NavigationProvider, useNavState, type AppTab, type Screen } from "@/features/shell/navigation";
import { Pane } from "@/features/shell/pane";
import { TabBoundary } from "@/features/shell/tab-boundary";
import { TAB_LABELS, TabComponents, prefetchAllTabCode } from "@/features/shell/tab-registry";

/**
 * The whole signed-in app: one page whose tabs switch in place. Opened tabs stay
 * mounted but hidden with <Activity> — it keeps their state and DOM, and pauses
 * their effects (polling, timers, subscriptions) until they're shown again.
 */
export function AppShell({ initialScreen, initialFlash }: { initialScreen: Screen; initialFlash: FlashParams }) {
  return (
    <NavigationProvider initialScreen={initialScreen} initialFlash={initialFlash}>
      <div className="flex h-screen min-h-0 overflow-hidden">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r bg-card md:flex">
          <div className="flex items-center gap-2 border-b px-4 py-4">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Radar className="size-4" />
            </div>
            <span className="font-semibold">IG Monitor</span>
          </div>
          <SidebarNav />
        </aside>
        <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
          <header className="sticky top-0 z-40 flex shrink-0 items-center justify-between border-b bg-card/90 px-4 py-3 backdrop-blur md:hidden">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Radar className="size-3.5" />
              </div>
              <span className="text-sm font-semibold">IG Monitor</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ThemeToggle />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Open menu" className="size-8">
                    <Menu className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 p-0 shadow-lg">
                  <SidebarNav showLinks={false} />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="relative min-h-0 flex-1 overflow-hidden">
            <TabPanels />
          </main>
        </div>
        <MobileTabBar />
      </div>
    </NavigationProvider>
  );
}

function TabPanels() {
  const { screen, alive, last } = useNavState();

  useEffect(() => {
    document.title = `${TAB_LABELS[screen.tab]} · IG Monitor`;
  }, [screen.tab]);

  // Once the first screen is up, fetch the other tabs' code in the background.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = idle(() => prefetchAllTabCode());
    return () => cancel(handle);
  }, []);

  return APP_TABS.filter((tab) => alive.includes(tab)).map((tab) => {
    const active = screen.tab === tab;
    return (
      <Activity key={tab} mode={active ? "visible" : "hidden"}>
        <TabBoundary label={TAB_LABELS[tab]}>
          <TabContent tab={tab} screen={active ? screen : (last[tab] ?? ({ tab } as Screen))} />
        </TabBoundary>
      </Activity>
    );
  });
}

function TabContent({ tab, screen }: { tab: AppTab; screen: Screen }) {
  switch (screen.tab) {
    case "targets":
      return <TabComponents.targets screen={screen} />;
    case "studio":
      return <TabComponents.studio screen={screen} />;
    case "settings":
      return (
        <Pane>
          <TabComponents.settings section={screen.section} anchor={screen.anchor} />
        </Pane>
      );
    default: {
      const Component = TabComponents[tab as "dashboard" | "storage" | "notifications"];
      return (
        <Pane>
          <Component />
        </Pane>
      );
    }
  }
}
