"use client";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { LayoutDashboard, Target, Clapperboard, HardDrive, Bell, Settings, LogOut } from "lucide-react";
import { SystemHealthBadge } from "@/features/monitoring/components/system-health-badge";
import { InstallAppButton } from "@/components/pwa/install-app-button";

export const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/targets", label: "Targets", icon: Target },
  { href: "/studio", label: "Studio", icon: Clapperboard },
  { href: "/storage", label: "Storage", icon: HardDrive },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function isNavActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ showLinks = true }: { showLinks?: boolean }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-1 flex-col justify-between p-3">
      {showLinks && (
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(item.href, pathname);
            return (
              <Link key={item.href} href={item.href} className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                <Icon className="size-4" />
                <span>{item.label}</span>
              </Link>
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
        <button onClick={() => signOut({ callbackUrl: "/login" })} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-destructive">
          <LogOut className="size-4" />
          <span>Log out</span>
        </button>
      </div>
    </div>
  );
}
