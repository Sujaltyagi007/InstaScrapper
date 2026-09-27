import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { assertPublicHttpUrl, UnsafeUrlError } from "./ssrf";

export class FetchLimitError extends Error {}

const MAX_REDIRECTS = 4;

interface FetchOptions {
  maxBytes: number;
  timeoutMs: number;
  headers?: Record<string, string>;
}

/**
 * Opens a public http(s) URL. Every redirect hop is checked against the SSRF
 * guard too; plain `fetch` would follow a redirect to a private address
 * without asking.
 */
async function openPublic(rawUrl: string, opts: FetchOptions): Promise<Response> {
  const signal = AbortSignal.timeout(opts.timeoutMs);
  let url = rawUrl;
  for (let hop = 0; ; hop++) {
    await assertPublicHttpUrl(url);
    const res = await fetch(url, { headers: opts.headers, redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location || hop >= MAX_REDIRECTS) throw new FetchLimitError("Too many redirects.");
      url = new URL(location, url).toString();
      continue;
    }
    if (!res.ok || !res.body) throw new FetchLimitError(`Download failed (HTTP ${res.status}).`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > opts.maxBytes) throw new FetchLimitError("File is too large.");
    return res;
  }
}

/** Reads the body chunk by chunk, stopping as soon as it passes the size cap. */
async function readCapped(res: Response, maxBytes: number, onChunk: (chunk: Uint8Array) => void | Promise<void>) {
  const reader = res.body!.getReader();
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return size;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FetchLimitError("File is too large.");
    }
    await onChunk(value);
  }
}

/** Downloads a public URL into memory, with a size cap and timeout. */
export async function fetchPublicBytes(
  rawUrl: string,
  opts: FetchOptions,
): Promise<{ bytes: Buffer; contentType: string | null }> {
  const res = await openPublic(rawUrl, opts);
  const chunks: Buffer[] = [];
  await readCapped(res, opts.maxBytes, (chunk) => {
    chunks.push(Buffer.from(chunk));
  });
  return { bytes: Buffer.concat(chunks), contentType: res.headers.get("content-type") };
}

/** Streams a public URL to a file, for downloads too big to hold in memory (HD video). */
export async function fetchPublicToFile(rawUrl: string, dest: string, opts: FetchOptions): Promise<number> {
  const res = await openPublic(rawUrl, opts);
  const out = createWriteStream(dest);
  const closed = new Promise<void>((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", reject);
  });
  try {
    const size = await readCapped(res, opts.maxBytes, (chunk) =>
      out.write(chunk) ? undefined : new Promise<void>((resolve) => out.once("drain", resolve)),
    );
    out.end();
    await closed;
    return size;
  } catch (err) {
    out.destroy();
    await unlink(dest).catch(() => {});
    throw err;
  }
}

export { UnsafeUrlError };
