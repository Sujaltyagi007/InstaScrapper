"use client";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

const noopSubscribe = () => () => { };
const readStoredTheme = () => localStorage.getItem("theme") ?? "system";
export function AppearanceCard() {
  const { setTheme } = useTheme();
  const theme = useSyncExternalStore(noopSubscribe, readStoredTheme, () => null);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription className="text-xs">Choose how IG Monitor looks on this device.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
          {OPTIONS.map((opt) => {
            const active = theme === opt.value;
            return (
              <button key={opt.value} type="button" role="radio" aria-checked={active} onClick={() => setTheme(opt.value)} className={cn("flex flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors", active ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",)} >
                <opt.icon className="size-4" />
                {opt.label}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
