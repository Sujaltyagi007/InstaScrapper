import { graphGet, graphPost, GraphApiError } from "./graph-client";
import type { GraphAccountConfig } from "./types";

/**
 * Official Instagram Content Publishing. Works with both Facebook Login tokens
 * (graph.facebook.com) and Instagram Login tokens (graph.instagram.com, no
 * Facebook Page needed); the account config says which host to call.
 * This replaces the private-API upload entirely: it is the sanctioned way to
 * post, so there is no proxy, no device spoofing and no ban risk from the
 * posting mechanism itself.
 *
 * Two-step flow:
 *   1. POST /{ig-user-id}/media         -> creation_id (a "container")
 *   2. POST /{ig-user-id}/media_publish -> the real media id
 *
 * ⚠️ Instagram fetches the media **from a public URL you provide** — it does not
 * accept raw bytes. So whatever is posted must be reachable by Meta's servers
 * (our storage URL works; a localhost URL does not).
 *
 * ⚠️ Content rights are NOT handled by this API. Posting media you don't own is
 * a copyright/ToS exposure on your real account regardless of how clean the
 * transport is. See docs/risk-model.md.
 */

export type PublishKind = "IMAGE" | "REEL";

export interface PublishInput {
  account: GraphAccountConfig;
  kind: PublishKind;
  /** Publicly reachable media URL. Meta fetches this server-side. */
  mediaUrl: string;
  caption?: string;
  /** Optional cover image for reels. */
  coverUrl?: string;
}

export interface PublishResult {
  ok: boolean;
  instagramMediaId?: string;
  errorCode?: string;
  errorMessage?: string;
}

/** Video containers are transcoded asynchronously, so publishing must wait. */
const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_POLL_MAX_ATTEMPTS = 24; // ~2 minutes

interface ContainerStatus {
  status_code?: "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";
  status?: string;
}

async function waitForContainerReady(
  containerId: string,
  account: GraphAccountConfig,
): Promise<{ ready: boolean; message?: string }> {
  for (let attempt = 0; attempt < VIDEO_POLL_MAX_ATTEMPTS; attempt += 1) {
    const res = await graphGet<ContainerStatus>(`/${containerId}`, {
      fields: "status_code,status",
      access_token: account.accessToken,
    }, { host: account.host });
    if (res.status_code === "FINISHED") return { ready: true };
    if (res.status_code === "ERROR" || res.status_code === "EXPIRED") {
      return { ready: false, message: res.status || `Container ${res.status_code}` };
    }
    await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
  }
  return { ready: false, message: "Instagram is still processing the video (timed out waiting)." };
}

/**
 * Current publish usage for the account. Meta's own docs have contradicted
 * themselves on the ceiling (25 vs 50 vs 100), so we read the real number
 * instead of hardcoding one. The window is a rolling 24h keyed to each publish,
 * not a midnight reset.
 */
export async function getPublishingLimit(account: GraphAccountConfig): Promise<{
  used: number | null;
  cap: number | null;
}> {
  try {
    const res = await graphGet<{
      data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }>;
    }>(`/${account.igUserId}/content_publishing_limit`, {
      fields: "config,quota_usage",
      access_token: account.accessToken,
    }, { host: account.host });
    const row = res.data?.[0];
    return {
      used: typeof row?.quota_usage === "number" ? row.quota_usage : null,
      cap: typeof row?.config?.quota_total === "number" ? row.config.quota_total : null,
    };
  } catch {
    // Never let a limit probe block a publish — the publish call itself will
    // report the real error if the quota is actually exhausted.
    return { used: null, cap: null };
  }
}

export async function publishToInstagram(input: PublishInput): Promise<PublishResult> {
  const { account, kind, mediaUrl, caption, coverUrl } = input;

  try {
    const limit = await getPublishingLimit(account);
    if (limit.used !== null && limit.cap !== null && limit.used >= limit.cap) {
      return {
        ok: false,
        errorCode: "PUBLISH_QUOTA_REACHED",
        errorMessage: `Instagram's 24-hour publishing limit is reached (${limit.used}/${limit.cap}). It frees up rolling, 24h after each post.`,
      };
    }

    // Step 1 — create the container.
    const container = await graphPost<{ id: string }>(`/${account.igUserId}/media`, {
      ...(kind === "REEL"
        ? { media_type: "REELS", video_url: mediaUrl, share_to_feed: "true", ...(coverUrl ? { cover_url: coverUrl } : {}) }
        : { image_url: mediaUrl }),
      ...(caption ? { caption } : {}),
      access_token: account.accessToken,
    }, { host: account.host });

    if (!container.id) {
      return { ok: false, errorCode: "PUBLISH_NO_CONTAINER", errorMessage: "Instagram did not return a media container." };
    }

    // Step 2 — reels must finish transcoding before they can be published.
    if (kind === "REEL") {
      const ready = await waitForContainerReady(container.id, account);
      if (!ready.ready) {
        return { ok: false, errorCode: "PUBLISH_PROCESSING_FAILED", errorMessage: ready.message };
      }
    }

    // Step 3 — publish.
    const published = await graphPost<{ id: string }>(`/${account.igUserId}/media_publish`, {
      creation_id: container.id,
      access_token: account.accessToken,
    }, { host: account.host });

    if (!published.id) {
      return { ok: false, errorCode: "PUBLISH_FAILED", errorMessage: "Instagram did not return a published media id." };
    }
    return { ok: true, instagramMediaId: published.id };
  } catch (error) {
    if (error instanceof GraphApiError) {
      if (error.code === 190 || error.code === 102) {
        return {
          ok: false,
          errorCode: "META_AUTH_ERROR",
          errorMessage: "Your Instagram connection expired. Reconnect it in Settings.",
        };
      }
      if (error.code === 4 || error.code === 17 || error.code === 32 || error.code === 613) {
        return { ok: false, errorCode: "PUBLISH_RATE_LIMITED", errorMessage: `Instagram rate limit: ${error.message}` };
      }
      return { ok: false, errorCode: "PUBLISH_FAILED", errorMessage: error.message };
    }
    return {
      ok: false,
      errorCode: "PUBLISH_FAILED",
      errorMessage: error instanceof Error ? error.message : "Publishing failed.",
    };
  }
}
