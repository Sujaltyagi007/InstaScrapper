import { Menu, Radar } from "lucide-react";
import "../globals.css"
import { Button } from "@/components/ui/button";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { ThemeToggle } from "@/components/common/theme-toggle";
import {  DropdownMenu,  DropdownMenuContent,  DropdownMenuTrigger,} from "@/components/ui/dropdown-menu";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="sticky top-0 h-screen hidden w-60 shrink-0 flex-col border-r bg-card md:flex overflow-y-auto">
        <div className="flex items-center gap-2 border-b px-4 py-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Radar className="size-4" />
          </div>
          <span className="font-semibold">IG Monitor</span>
        </div>
        <SidebarNav />
      </aside>
      <div className="flex flex-1 flex-col min-w-0 h-screen overflow-hidden">
        <header className="sticky top-0 z-40 flex items-center justify-between border-b bg-card/90 px-4 py-3 backdrop-blur md:hidden shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Radar className="size-3.5" />
            </div>
            <span className="font-semibold text-sm">IG Monitor</span>
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
                <SidebarNav />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-3 sm:p-6 md:p-8 min-h-0 flex flex-col">
          <div className="mx-auto w-full max-w-6xl flex-1 flex flex-col min-h-0">{children}</div>
        </main>
      </div>
    </div>
  );
}
