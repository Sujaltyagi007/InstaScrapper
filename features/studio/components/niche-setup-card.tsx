"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { NicheData } from "../hooks/use-niche";

export function NicheSetupCard({ niche, onSaved }: { niche: NicheData["niche"]; onSaved: () => void }) {
  const [name, setName] = useState(niche?.name ?? "");
  const [description, setDescription] = useState(niche?.description ?? "");
  const [language, setLanguage] = useState(niche?.language ?? "en");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await apiFetch("/api/niche", {
        method: "PUT",
        body: JSON.stringify({ name, description: description || null, language }),
      });
      toast.success("Niche saved.");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save niche.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your niche</CardTitle>
        <CardDescription>
          What your account is about. Trend ideas, scripts and captions are all written for this.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="niche-name">Niche</Label>
          <Input
            id="niche-name"
            placeholder="e.g. Personal finance for students"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="niche-description">Details (optional)</Label>
          <textarea
            id="niche-description"
            rows={3}
            placeholder="Audience, tone, topics to focus on or avoid…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="niche-language">Language</Label>
          <Input
            id="niche-language"
            className="max-w-48"
            placeholder="en, hi, Hinglish…"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          />
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={save} disabled={saving || name.trim().length < 2}>
          {saving && <Loader2 className="animate-spin" />} Save niche
        </Button>
      </CardFooter>
    </Card>
  );
}
