"use client";
import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isNavActive } from "@/components/layout/sidebar-nav";

const COUNT = NAV_ITEMS.length;

export function MobileTabBar() {
  const pathname = usePathname();
  // The pill moves on tap, before the next page has loaded. Once the route changes,
  // `from` no longer matches and the real route takes over again.
  const [tapped, setTapped] = useState<{ href: string; from: string } | null>(null);

  const routeIndex = NAV_ITEMS.findIndex((item) => isNavActive(item.href, pathname));
  const tappedIndex = tapped && tapped.from === pathname ? NAV_ITEMS.findIndex((item) => item.href === tapped.href) : -1;
  const index = tappedIndex >= 0 ? tappedIndex : routeIndex;

  return (
    <nav
      aria-label="Main"
      // z-45: stays above full-screen views like the target's Instagram view (z-42).
      className="pointer-events-none fixed inset-x-0 bottom-0 z-45 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:hidden"
    >
      <div
        className="pointer-events-auto relative mx-auto grid max-w-sm rounded-full bg-neutral-900 p-1.5 shadow-xl shadow-black/25 ring-1 ring-white/10 dark:bg-neutral-800"
        style={{ gridTemplateColumns: `repeat(${COUNT}, minmax(0, 1fr))` }}
      >
        {index >= 0 && (
          <span
            aria-hidden
            className="absolute inset-y-1.5 left-1.5 flex items-center justify-center transition-transform duration-500 ease-[cubic-bezier(0.34,1.3,0.64,1)] motion-reduce:transition-none"
            style={{ width: `calc((100% - 0.75rem) / ${COUNT})`, transform: `translateX(${index * 100}%)` }}
          >
            <span className="size-10 rounded-full bg-white shadow-md shadow-black/20" />
          </span>
        )}
        {NAV_ITEMS.map((item, i) => {
          const Icon = item.icon;
          const active = i === index;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              title={item.label}
              aria-current={i === routeIndex ? "page" : undefined}
              onClick={() => setTapped({ href: item.href, from: pathname })}
              className={cn(
                "relative z-10 flex h-10 items-center justify-center rounded-full outline-none transition-[color,transform] duration-300 active:scale-90 focus-visible:ring-2 focus-visible:ring-white/60",
                active ? "text-neutral-900" : "text-neutral-400 hover:text-white",
              )}
            >
              <Icon className="size-4.5" strokeWidth={active ? 2.25 : 2} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
