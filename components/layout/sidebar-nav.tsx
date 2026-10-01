"use client";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { LogOut } from "lucide-react";
import { SystemHealthBadge } from "@/features/monitoring/components/system-health-badge";
import { InstallAppButton } from "@/components/pwa/install-app-button";
import { useNavState } from "@/features/shell/navigation";
import { NAV_ITEMS } from "@/features/shell/tab-registry";
import { TabLink } from "@/features/shell/tab-link";
import { signOutAndForget } from "@/features/shell/sign-out";

export function SidebarNav({ showLinks = true }: { showLinks?: boolean }) {
  const { screen } = useNavState();

  return (
    <div className="flex flex-1 flex-col justify-between p-3">
      {showLinks && (
        <nav className="flex flex-col gap-1" aria-label="Main">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = screen.tab === item.tab;
            return (
              <TabLink key={item.tab} tab={item.tab} className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                <Icon className="size-4" />
                <span>{item.label}</span>
              </TabLink>
            );
          })}
        </nav>
      )}

      <div className={cn("space-y-2", showLinks && "pt-3 border-t")}>
        <SystemHealthBadge />
        <InstallAppButton />
        <div className="flex items-center justify-between px-3">
          <span className="text-sm font-medium text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
        <button onClick={signOutAndForget} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-destructive">
          <LogOut className="size-4" />
          <span>Log out</span>
        </button>
      </div>
    </div>
  );
}
