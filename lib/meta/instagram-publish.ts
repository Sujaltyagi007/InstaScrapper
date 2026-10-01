import { createHash, randomUUID } from "crypto";
import sharp from "sharp";
import { tlsRequestRaw } from "./tls-transport";

const IG_ANDROID_APP_ID = "567067343352427";

interface Device {
  uuid: string;
  androidId: string;
  userAgent: string;
  manufacturer: string;
  model: string;
}

/** Random 0..(n-1) drawn deterministically from a hex hash slice. */
function pick<T>(items: T[], hex: string): T {
  return items[parseInt(hex.slice(0, 8), 16) % items.length];
}

function toUuid(hex: string): string {
  const h = hex.padEnd(32, "0").slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function deviceFor(seed: string | undefined): Device {
  const h = createHash("sha256").update(seed || randomUUID()).digest("hex");
  const phones: Array<[string, string]> = [
    ["samsung", "SM-G991B"],
    ["samsung", "SM-G973F"],
    ["Google", "Pixel 6"],
    ["OnePlus", "IN2023"],
    ["Xiaomi", "M2101K6G"],
  ];
  const [manufacturer, model] = pick(phones, h);
  return {
    uuid: toUuid(h.slice(0, 32)),
    androidId: "android-" + h.slice(32, 48),
    manufacturer,
    model,
    userAgent:
      `Instagram 269.0.0.18.75 Android (30/11; 420dpi; 1080x2340; ${manufacturer}; ${model}; ` +
      `${model}; qcom; en_US; 431634833)`,
  };
}

function mobileHeaders(cookies: Record<string, string>, device: Device): Record<string, string> {
  const cookieStr = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const headers: Record<string, string> = {
    "User-Agent": device.userAgent,
    "X-IG-App-ID": IG_ANDROID_APP_ID,
    "X-IG-Device-ID": device.uuid,
    "X-IG-Android-ID": device.androidId,
    "X-IG-Capabilities": "3brTvw==",
    "X-IG-Connection-Type": "WIFI",
    "Accept-Language": "en-US",
    "Accept-Encoding": "gzip",
    Cookie: cookieStr,
  };
  if (cookies.csrftoken) headers["X-CSRFToken"] = cookies.csrftoken;
  return headers;
}

const humanPause = (min: number, max: number) =>
  new Promise((r) => setTimeout(r, Math.floor(min + Math.random() * (max - min))));

/**
 * Minimal MP4 box walk to read duration + dimensions without an ffmpeg
 * dependency (Vercel can't run one). Reads `mvhd` (timescale+duration) and the
 * first `tkhd` (16.16 fixed-point width/height). Returns sane defaults if the
 * container isn't a plain MP4/MOV.
 */
export function parseMp4Meta(buf: Buffer): { durationMs: number; width: number; height: number } {
  let durationMs = 0;
  let width = 0;
  let height = 0;
  const len = buf.length;

  // Walk top-level + one level into `moov`, since mvhd/trak live under it.
  function walk(start: number, end: number) {
    let i = start;
    while (i + 8 <= end) {
      const size = buf.readUInt32BE(i);
      const type = buf.toString("latin1", i + 4, i + 8);
      const boxEnd = size === 0 ? end : i + size;
      if (size < 8 || boxEnd > end) break;

      if (type === "moov" || type === "trak" || type === "mdia") {
        walk(i + 8, boxEnd);
      } else if (type === "mvhd" && durationMs === 0) {
        const version = buf[i + 8];
        if (version === 1) {
          const timescale = buf.readUInt32BE(i + 28);
          const dur = Number(buf.readBigUInt64BE(i + 32));
          if (timescale) durationMs = Math.round((dur / timescale) * 1000);
        } else {
          const timescale = buf.readUInt32BE(i + 20);
          const dur = buf.readUInt32BE(i + 24);
          if (timescale) durationMs = Math.round((dur / timescale) * 1000);
        }
      } else if (type === "tkhd" && width === 0) {
        // width/height (16.16 fixed) sit at the end of tkhd, after the 36-byte
        // matrix. Payload offset: v0 = 76, v1 = 88 (v1 uses 8-byte times).
        const version = buf[i + 8];
        const base = i + 8 + (version === 1 ? 88 : 76);
        const w = buf.readUInt32BE(base) / 65536;
        const h = buf.readUInt32BE(base + 4) / 65536;
        if (w > 0 && h > 0) {
          width = Math.round(w);
          height = Math.round(h);
        }
      }
      i = boxEnd;
    }
  }
  try {
    walk(0, len);
  } catch {
    /* fall through to defaults */
  }
  return {
    durationMs: durationMs > 0 ? durationMs : 15000,
    width: width > 0 ? width : 720,
    height: height > 0 ? height : 1280,
  };
}

export interface PublishPhotoInput {
  cookies: Record<string, string>;
  proxyUrl?: string | null;
  /** JPEG bytes to publish (already downloaded by the caller). */
  imageJpeg: Buffer;
  caption: string;
  /** Reuse the session's stored deviceId as the seed for a stable identity. */
  deviceSeed?: string;
  /** When true, returns the planned requests without sending anything. */
  dryRun?: boolean;
}

export interface PublishResult {
  ok: boolean;
  mediaId?: string;
  code?: string;
  message?: string;
  /** Raw Instagram response body (truncated) for diagnosis/iteration. */
  raw?: string;
  /** Only in dryRun: the requests that WOULD be sent (no cookie values). */
  planned?: Array<{ step: string; url: string; method: string; headerKeys: string[]; bodyInfo: string }>;
}

export async function publishPhoto(input: PublishPhotoInput): Promise<PublishResult> {
  const { cookies, proxyUrl, imageJpeg, caption } = input;

  if (!cookies.sessionid || !cookies.ds_user_id) {
    return { ok: false, message: "Session is missing sessionid/ds_user_id — re-add the account." };
  }

  const device = deviceFor(input.deviceSeed || cookies.ds_user_id);
  const meta = await sharp(imageJpeg).metadata();
  const width = meta.width ?? 1080;
  const height = meta.height ?? 1080;

  const uploadId = Date.now().toString();
  const name = `${uploadId}_0_${Math.floor(1e9 + Math.random() * 8e9)}`;
  const waterfall = randomUUID();

  const ruploadParams = {
    retry_context: JSON.stringify({ num_step_auto_retry: 0, num_reupload: 0, num_step_manual_retry: 0 }),
    media_type: "1",
    xsharing_user_ids: "[]",
    upload_id: uploadId,
    image_compression: JSON.stringify({ lib_name: "moz", lib_version: "3.1.m", quality: "80" }),
  };

  const uploadUrl = `https://i.instagram.com/rupload_igphoto/${name}`;
  const uploadHeaders: Record<string, string> = {
    ...mobileHeaders(cookies, device),
    "X-Instagram-Rupload-Params": JSON.stringify(ruploadParams),
    X_FB_PHOTO_WATERFALL_ID: waterfall,
    "X-Entity-Type": "image/jpeg",
    Offset: "0",
    "X-Entity-Name": name,
    "X-Entity-Length": String(imageJpeg.length),
    "Content-Type": "application/octet-stream",
    "Content-Length": String(imageJpeg.length),
  };

  const configureUrl = "https://i.instagram.com/api/v1/media/configure/";
  const now = Math.floor(Date.now() / 1000).toString();
  const configureData: Record<string, string> = {
    upload_id: uploadId,
    source_type: "4",
    caption,
    device: JSON.stringify({
      manufacturer: device.manufacturer,
      model: device.model,
      android_version: 30,
      android_release: "11",
    }),
    edits: JSON.stringify({ crop_original_size: [width, height], crop_center: [0.0, 0.0], crop_zoom: 1.0 }),
    extra: JSON.stringify({ source_width: width, source_height: height }),
    timezone_offset: "0",
    date_time_original: now,
    date_time_digitalized: now,
    _uid: cookies.ds_user_id,
    _uuid: device.uuid,
    _csrftoken: cookies.csrftoken ?? "",
  };
  // Instagram no longer verifies the signature; the literal "SIGNATURE." prefix
  // over the JSON is what its clients still send.
  const configureBody = new URLSearchParams({
    signed_body: "SIGNATURE." + JSON.stringify(configureData),
  }).toString();
  const configureHeaders = {
    ...mobileHeaders(cookies, device),
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  };

  if (input.dryRun) {
    return {
      ok: true,
      message: "dry run — nothing sent",
      planned: [
        { step: "rupload", url: uploadUrl, method: "POST", headerKeys: Object.keys(uploadHeaders), bodyInfo: `${imageJpeg.length} bytes (${width}x${height})` },
        { step: "configure", url: configureUrl, method: "POST", headerKeys: Object.keys(configureHeaders), bodyInfo: `signed_body ${configureBody.length} chars, caption ${caption.length} chars` },
      ],
    };
  }

  // 1) Upload the bytes.
  const up = await tlsRequestRaw({
    url: uploadUrl,
    method: "POST",
    headers: uploadHeaders,
    bodyBytes: imageJpeg,
    proxyUrl,
    tlsClientIdentifier: "chrome_120",
    timeoutSeconds: 60,
  });
  let upJson: Record<string, unknown> = {};
  try { upJson = JSON.parse(up.body); } catch { /* non-JSON error page */ }
  if (up.status !== 200 || upJson.status !== "ok") {
    return { ok: false, message: "Upload step failed.", raw: up.body.slice(0, 400) };
  }

  // Human gap: a person reviews the photo before hitting "Share".
  await humanPause(1500, 4000);

  // 2) Configure (publish) with the caption.
  const conf = await tlsRequestRaw({
    url: configureUrl,
    method: "POST",
    headers: configureHeaders,
    body: configureBody,
    proxyUrl,
    tlsClientIdentifier: "chrome_120",
    timeoutSeconds: 60,
  });
  let confJson: Record<string, unknown> = {};
  try { confJson = JSON.parse(conf.body); } catch { /* ignore */ }

  if (conf.status === 200 && confJson.status === "ok" && confJson.media) {
    const media = confJson.media as Record<string, unknown>;
    return { ok: true, mediaId: String(media.pk ?? media.id ?? ""), code: String(media.code ?? "") };
  }

  // Surface Instagram's own message so the caller can react (checkpoint,
  // feedback_required/spam block, expired session, …).
  return {
    ok: false,
    message: String(confJson.message ?? "Publish (configure) step failed."),
    code: String(confJson.spam ? "spam_block" : confJson.error_type ?? ""),
    raw: conf.body.slice(0, 400),
  };
}

export interface PublishVideoInput {
  cookies: Record<string, string>;
  proxyUrl?: string | null;
  videoMp4: Buffer;
  thumbnailJpeg: Buffer;
  caption: string;
  deviceSeed?: string;
  dryRun?: boolean;
}


export async function publishVideo(input: PublishVideoInput): Promise<PublishResult> {
  const { cookies, proxyUrl, videoMp4, thumbnailJpeg, caption } = input;
  if (!cookies.sessionid || !cookies.ds_user_id) {
    return { ok: false, message: "Session is missing sessionid/ds_user_id — re-add the account." };
  }

  const device = deviceFor(input.deviceSeed || cookies.ds_user_id);
  const { durationMs, width, height } = parseMp4Meta(videoMp4);
  const uploadId = Date.now().toString();
  const waterfall = randomUUID();
  const videoName = `${uploadId}_0_${Math.floor(1e9 + Math.random() * 8e9)}`;

  const videoRuploadParams = {
    retry_context: JSON.stringify({ num_step_auto_retry: 0, num_reupload: 0, num_step_manual_retry: 0 }),
    media_type: "2",
    xsharing_user_ids: "[]",
    upload_id: uploadId,
    upload_media_duration_ms: String(Math.round(durationMs)),
    upload_media_height: String(height),
    upload_media_width: String(width),
    is_clips_video: "1",
  };
  const videoUrl = `https://i.instagram.com/rupload_igvideo/${videoName}`;
  const videoHeaders: Record<string, string> = {
    ...mobileHeaders(cookies, device),
    "X-Instagram-Rupload-Params": JSON.stringify(videoRuploadParams),
    X_FB_VIDEO_WATERFALL_ID: waterfall,
    "X-Entity-Type": "video/mp4",
    Offset: "0",
    "X-Entity-Name": videoName,
    "X-Entity-Length": String(videoMp4.length),
    "Content-Type": "application/octet-stream",
    "Content-Length": String(videoMp4.length),
  };

  // Cover photo shares the video's upload_id so IG links them.
  const coverName = `${uploadId}_0_${Math.floor(1e9 + Math.random() * 8e9)}`;
  const coverParams = {
    retry_context: JSON.stringify({ num_step_auto_retry: 0, num_reupload: 0, num_step_manual_retry: 0 }),
    media_type: "2",
    xsharing_user_ids: "[]",
    upload_id: uploadId,
    image_compression: JSON.stringify({ lib_name: "moz", lib_version: "3.1.m", quality: "80" }),
  };
  const coverUrl = `https://i.instagram.com/rupload_igphoto/${coverName}`;
  const coverHeaders: Record<string, string> = {
    ...mobileHeaders(cookies, device),
    "X-Instagram-Rupload-Params": JSON.stringify(coverParams),
    X_FB_PHOTO_WATERFALL_ID: waterfall,
    "X-Entity-Type": "image/jpeg",
    Offset: "0",
    "X-Entity-Name": coverName,
    "X-Entity-Length": String(thumbnailJpeg.length),
    "Content-Type": "application/octet-stream",
    "Content-Length": String(thumbnailJpeg.length),
  };

  const configureUrl = "https://i.instagram.com/api/v1/media/configure_to_clips/";
  const configureData: Record<string, string> = {
    caption,
    upload_id: uploadId,
    source_type: "4",
    poster_frame_index: "0",
    length: String(Math.round(durationMs / 1000)),
    audio_muted: "false",
    filter_type: "0",
    clips_uses_original_audio: "1",
    device: JSON.stringify({
      manufacturer: device.manufacturer,
      model: device.model,
      android_version: 30,
      android_release: "11",
    }),
    extra: JSON.stringify({ source_width: width, source_height: height }),
    timezone_offset: "0",
    _uid: cookies.ds_user_id,
    _uuid: device.uuid,
    _csrftoken: cookies.csrftoken ?? "",
  };
  const configureBody = new URLSearchParams({ signed_body: "SIGNATURE." + JSON.stringify(configureData) }).toString();
  const configureHeaders = {
    ...mobileHeaders(cookies, device),
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  };

  if (input.dryRun) {
    return {
      ok: true,
      message: "dry run — nothing sent",
      planned: [
        { step: "rupload_igvideo", url: videoUrl, method: "POST", headerKeys: Object.keys(videoHeaders), bodyInfo: `${videoMp4.length} bytes (${width}x${height}, ${Math.round(durationMs / 1000)}s)` },
        { step: "rupload_igphoto(cover)", url: coverUrl, method: "POST", headerKeys: Object.keys(coverHeaders), bodyInfo: `${thumbnailJpeg.length} bytes` },
        { step: "configure_to_clips", url: configureUrl, method: "POST", headerKeys: Object.keys(configureHeaders), bodyInfo: `signed_body ${configureBody.length} chars` },
      ],
    };
  }

  // 1) Upload video bytes.
  const vres = await tlsRequestRaw({ url: videoUrl, method: "POST", headers: videoHeaders, bodyBytes: videoMp4, proxyUrl, timeoutSeconds: 120 });
  let vjson: Record<string, unknown> = {};
  try { vjson = JSON.parse(vres.body); } catch { /* ignore */ }
  if (vres.status !== 200 || vjson.status !== "ok") {
    return { ok: false, message: "Video upload step failed.", raw: vres.body.slice(0, 400) };
  }

  await humanPause(1000, 2500);

  // 2) Upload cover.
  const cres = await tlsRequestRaw({ url: coverUrl, method: "POST", headers: coverHeaders, bodyBytes: thumbnailJpeg, proxyUrl, timeoutSeconds: 60 });
  let cjson: Record<string, unknown> = {};
  try { cjson = JSON.parse(cres.body); } catch { /* ignore */ }
  if (cres.status !== 200 || cjson.status !== "ok") {
    return { ok: false, message: "Cover upload step failed.", raw: cres.body.slice(0, 400) };
  }

  // 3) Configure — poll while Instagram is still transcoding.
  const MAX_CONFIGURE = 6;
  let last = "";
  for (let attempt = 0; attempt < MAX_CONFIGURE; attempt++) {
    if (attempt > 0) await humanPause(5000, 12000);
    const conf = await tlsRequestRaw({ url: configureUrl, method: "POST", headers: configureHeaders, body: configureBody, proxyUrl, timeoutSeconds: 60 });
    last = conf.body.slice(0, 400);
    let cf: Record<string, unknown> = {};
    try { cf = JSON.parse(conf.body); } catch { /* ignore */ }

    if (conf.status === 200 && cf.status === "ok" && cf.media) {
      const media = cf.media as Record<string, unknown>;
      return { ok: true, mediaId: String(media.pk ?? media.id ?? ""), code: String(media.code ?? "") };
    }
    // Still processing → keep polling; anything else → stop.
    const msg = String(cf.message ?? "");
    if (!/not finished|transcode|processing/i.test(msg)) {
      return { ok: false, message: msg || "Publish (configure_to_clips) failed.", code: String(cf.spam ? "spam_block" : cf.error_type ?? ""), raw: last };
    }
  }
  return { ok: false, message: "Instagram was still transcoding after several tries — try again shortly.", raw: last };
}
