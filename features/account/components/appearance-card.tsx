"use client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { apiFetch } from "@/lib/fetcher";
import { friendlyError } from "@/lib/friendly-error";
import type { UserSettings } from "@/hooks/use-settings";
import { Sun, Moon, Monitor, Palette } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";
import { applyAccentColor } from "@/lib/theme/apply-accent-client";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

const UNSET_SWATCH = "#71717a";

const noopSubscribe = () => () => { };
const readStoredTheme = () => localStorage.getItem("theme") ?? "system";

export function AppearanceCard({ settings, onSaved }: { settings?: UserSettings | null; onSaved?: () => void }) {
  const { setTheme } = useTheme();
  const theme = useSyncExternalStore(noopSubscribe, readStoredTheme, () => null);
  const [color, setColor] = useState(settings?.accentColor ?? UNSET_SWATCH);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function persist(accentColor: string | null) {
    setSaving(true);
    try {
      await apiFetch("/api/settings", { method: "PATCH", body: JSON.stringify({ accentColor }) });
      onSaved?.();
    } catch (err) {
      toast.error(friendlyError(err, "Failed to save accent color."));
    } finally {
      setSaving(false);
    }
  }

  function handlePick(hex: string) {
    setColor(hex);
    applyAccentColor(hex);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(hex), 500);
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription className="text-xs">Choose how IG Monitor looks on this device.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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

        {settings && (
          <div className="flex items-center justify-between gap-4 border-t pt-4">
            <div className="flex items-center gap-2">
              <Palette className="size-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Accent color</p>
                <p className="text-xs text-muted-foreground">
                  Colors buttons, links, and highlights across the app.
                  {saving && " Saving…"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {settings.accentColor && (
                <button type="button" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => {
                    if (saveTimer.current) clearTimeout(saveTimer.current);
                    setColor(UNSET_SWATCH);
                    applyAccentColor(null);
                    persist(null);
                  }} >
                  Reset
                </button>
              )}
              <input
                type="color"
                aria-label="Accent color"
                value={color}
                onInput={(e) => handlePick(e.currentTarget.value)}
                className="size-9 cursor-pointer rounded-md border bg-transparent p-1"
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
