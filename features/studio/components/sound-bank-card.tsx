"use client";
import { friendlyError } from "@/lib/friendly-error";
import { toast } from "sonner";
import { apiFetch } from "@/lib/fetcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import useSWR from "swr";
import { useCallback, useRef, useState } from "react";
import { ErrorState } from "@/components/common/error-state";
import { LoadingState } from "@/components/common/loading-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Sound {
  id: string;
  kind: "MUSIC" | "SFX";
  title: string;
  source: string | null;
  licenseUrl: string | null;
  moodTags: string[];
  bpm: number | null;
  energy: string | null;
  description: string | null;
  durationMs: number;
  storageUrl: string;
}

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

export function SoundBankCard() {
  const { data, error, isLoading, mutate } = useSWR<{ sounds: Sound[] }>("/api/sounds");
  const sounds = data?.sounds ?? null;
  const [kind, setKind] = useState<"MUSIC" | "SFX">("MUSIC");
  const [url, setUrl] = useState("");
  const [licenseUrl, setLicenseUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => mutate(), [mutate]);

  async function add() {
    const file = fileRef.current?.files?.[0];
    if (!file && !url.trim()) {
      toast.error("Choose a file or paste a link.");
      return;
    }
    if (file && file.size > MAX_UPLOAD_BYTES) {
      toast.error("Files over 4 MB have to be added by link.");
      return;
    }
    const form = new FormData();
    form.set("kind", kind);
    if (file) form.set("file", file);
    else form.set("url", url.trim());
    if (licenseUrl.trim()) form.set("licenseUrl", licenseUrl.trim());

    setAdding(true);
    try {
      const res = await apiFetch<{ sound: Sound; tagged: boolean; trimmed: boolean }>("/api/sounds", {
        method: "POST",
        body: form,
      });
      toast.success(
        `Added "${res.sound.title}".` +
          (res.tagged ? "" : " Couldn't tag it automatically, so it may be picked less well.") +
          (res.trimmed ? " It was trimmed to the maximum length." : ""),
      );
      setUrl("");
      setLicenseUrl("");
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
    } catch (err) {
      toast.error(friendlyError(err, "Failed to add the sound."));
    } finally {
      setAdding(false);
    }
  }

  async function remove(sound: Sound) {
    setDeleting(sound.id);
    // Optimistic: the row disappears at once; a failure brings it back via the re-fetch.
    mutate((cur) => cur && { sounds: cur.sounds.filter((s) => s.id !== sound.id) }, { revalidate: false });
    try {
      await apiFetch(`/api/sounds/${sound.id}`, { method: "DELETE" });
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't delete that sound."));
    } finally {
      await refresh();
      setDeleting(null);
    }
  }

  const music = sounds?.filter((s) => s.kind === "MUSIC") ?? [];
  const effects = sounds?.filter((s) => s.kind === "SFX") ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sound bank</CardTitle>
        <CardDescription>
          Licensed music and sound effects your reels are mixed from. Reels never reuse the trending reel&apos;s audio;
          they match its feel with sounds from here. Free sources: Pixabay Music and Sound Effects, or CC0 sounds on
          Freesound. Keep the licence link so a wrong copyright claim can be disputed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex gap-2">
            <Button size="sm" variant={kind === "MUSIC" ? "default" : "outline"} onClick={() => setKind("MUSIC")}>
              Music
            </Button>
            <Button size="sm" variant={kind === "SFX" ? "default" : "outline"} onClick={() => setKind("SFX")}>
              Sound effect
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sound-file">File (up to 4 MB)</Label>
              <Input id="sound-file" ref={fileRef} type="file" accept="audio/*" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sound-url">…or direct download link</Label>
              <Input id="sound-url" placeholder="https://cdn.pixabay.com/…mp3" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sound-licence">Licence or source page (recommended)</Label>
            <Input
              id="sound-licence"
              placeholder="https://pixabay.com/music/…"
              value={licenseUrl}
              onChange={(e) => setLicenseUrl(e.target.value)}
            />
          </div>
          <Button className="w-fit" onClick={add} disabled={adding}>
            {adding ? <Loader2 className="animate-spin" /> : <Plus />} Add {kind === "MUSIC" ? "music" : "sound effect"}
          </Button>
        </div>

        {isLoading && !sounds ? (
          <LoadingState rows={3} />
        ) : error && !sounds ? (
          <ErrorState title="Couldn't load your sound bank" message={friendlyError(error)} onRetry={refresh} />
        ) : !sounds || sounds.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sounds yet. Reels will still be made, with the voice only. Around 20 tracks and 10 effects (whoosh, pop,
            riser, ding) give good variety.
          </p>
        ) : (
          [
            { label: `Music (${music.length})`, items: music },
            { label: `Sound effects (${effects.length})`, items: effects },
          ].map(
            (group) =>
              group.items.length > 0 && (
                <div key={group.label} className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">{group.label}</h3>
                  <ul className="flex flex-col gap-2">
                    {group.items.map((s) => (
                      <li key={s.id} className="flex flex-col gap-2 rounded-lg border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="font-medium">{s.title}</span>
                            <span className="text-xs text-muted-foreground">
                              {duration(s.durationMs)}
                              {s.bpm ? ` · ${s.bpm} BPM` : ""}
                              {s.energy ? ` · ${s.energy} energy` : ""}
                            </span>
                            {s.licenseUrl && (
                              <a
                                href={s.licenseUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                              >
                                licence <ExternalLink className="size-3" />
                              </a>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={deleting === s.id}
                            onClick={() => remove(s)}
                            aria-label={`Delete ${s.title}`}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                        {s.moodTags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {s.moodTags.map((t) => (
                              <Badge key={t} variant="secondary">
                                {t}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                        <audio controls preload="none" src={s.storageUrl} className="h-8 w-full" />
                      </li>
                    ))}
                  </ul>
                </div>
              ),
          )
        )}
      </CardContent>
    </Card>
  );
}
