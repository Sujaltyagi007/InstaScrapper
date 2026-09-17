"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { UserSettings } from "@/hooks/use-settings";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

/**
 * Human-like schedule settings: the user's timezone and a nightly "sleep"
 * window during which no scheduled checks run. Keyed by the parent on the
 * saved values, so it remounts with fresh state after each save.
 */
export function CheckScheduleCard({ settings, onSaved }: { settings: UserSettings; onSaved: () => void }) {
  const [timezone, setTimezone] = useState(settings.timezone);
  const [sleepEnabled, setSleepEnabled] = useState(settings.sleepEnabled);
  const [sleepStartHour, setSleepStartHour] = useState(settings.sleepStartHour);
  const [sleepEndHour, setSleepEndHour] = useState(settings.sleepEndHour);
  const [saving, setSaving] = useState(false);

  const browserZone =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const emptyWindow = sleepEnabled && sleepStartHour === sleepEndHour;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ timezone, sleepEnabled, sleepStartHour, sleepEndHour }),
      });
      toast.success("Schedule saved.");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save schedule.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Human-like check schedule</CardTitle>
        <CardDescription>
          Checks run one at a time with random gaps, like a person browsing. During sleep hours no
          scheduled checks run; they resume gradually afterwards. &quot;Run check now&quot; always works.
        </CardDescription>
      </CardHeader>
      <form onSubmit={save}>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="timezone">Timezone</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="e.g. Asia/Kolkata"
                className="max-w-64"
              />
              {browserZone && browserZone !== timezone && (
                <Button type="button" variant="outline" size="sm" onClick={() => setTimezone(browserZone)}>
                  Use my timezone ({browserZone})
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Sleep hours and active hours use this timezone.</p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="sleep-enabled">Sleep hours</Label>
              <p className="text-xs text-muted-foreground">Pause scheduled checks overnight.</p>
            </div>
            <Switch id="sleep-enabled" checked={sleepEnabled} onCheckedChange={setSleepEnabled} />
          </div>

          {sleepEnabled && (
            <div className="flex flex-wrap items-end gap-3">
              <HourSelect id="sleep-start" label="From" value={sleepStartHour} onChange={setSleepStartHour} />
              <HourSelect id="sleep-end" label="Until" value={sleepEndHour} onChange={setSleepEndHour} />
              <p className="w-full text-xs text-muted-foreground">
                {emptyWindow
                  ? "Start and end are the same, so there is no sleep window."
                  : `No scheduled checks from ${formatHour(sleepStartHour)} to ${formatHour(sleepEndHour)}${sleepStartHour > sleepEndHour ? " (overnight)" : ""
                  }.`}
              </p>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={saving || !timezone.trim()}>
            {saving && <Loader2 className="animate-spin" />}
            Save schedule
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function HourSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (hour: number) => void;
}) {
  // Native select: 24 fixed options, and it behaves well on mobile.
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 rounded-md border bg-background px-2 text-sm"
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {formatHour(h)}
          </option>
        ))}
      </select>
    </div>
  );
}
