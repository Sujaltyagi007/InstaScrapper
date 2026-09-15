import { assertPublicHttpUrl } from "@/lib/security/ssrf";
import type { NtfyConfig, NotificationMessage } from "../types";

export async function sendNtfy(config: NtfyConfig, message: NotificationMessage): Promise<void> {
  const url = `${config.serverUrl.replace(/\/$/, "")}/${config.topic}`;
  await assertPublicHttpUrl(url);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Title: message.title,
      Tags: "camera_flash",
      ...(config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : {}),
      ...(message.url ? { Click: message.url } : {}),
    },
    body: message.body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`ntfy responded ${res.status}: ${await safeText(res)}`);
  }
}

async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
