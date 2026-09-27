import { tlsRequestRaw } from "./tls-transport";

/**
 * Server-side Instagram web login → genuine session cookies.
 * ---------------------------------------------------------------------------
 * Mirrors what a browser does: bootstrap for a csrftoken, then POST the login
 * with the encrypted-password envelope and the right headers/fingerprint, and
 * read `sessionid` out of the response cookie jar (why this needs the
 * cookie-aware `tls-transport`, not the scraping axios client).
 *
 * This is the highest ban-risk path in the app; it is burner-only by policy
 * and the password is used once here and never stored.
 *
 * Not every account can be logged in this way: 2FA needs a second step, and a
 * checkpoint challenge can't be solved headlessly (caller falls back to the
 * manual cookie-paste flow).
 */

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const WEB_APP_ID = "936619743392459";
const LOGIN_URL = "https://www.instagram.com/api/v1/web/accounts/login/ajax/";
const TWO_FACTOR_URL = "https://www.instagram.com/api/v1/web/accounts/login/two_factor/";

export interface LoginBootstrap {
  csrftoken: string;
  mid: string;
}

export type LoginResult =
  | { status: "authenticated"; cookies: Record<string, string>; userId: string }
  | { status: "two_factor_required"; twoFactorIdentifier: string; username: string; bootstrap: LoginBootstrap }
  | { status: "checkpoint_required"; message: string }
  | { status: "bad_credentials"; message: string }
  | { status: "error"; message: string };

/** Instagram's logged-out password envelope. Version 0 = no client-side encryption. */
function encodePassword(password: string): string {
  return `#PWD_INSTAGRAM_BROWSER:0:${Math.floor(Date.now() / 1000)}:${password}`;
}

function loginHeaders(bootstrap: LoginBootstrap, userAgent: string): Record<string, string> {
  return {
    "User-Agent": userAgent,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/x-www-form-urlencoded",
    "X-CSRFToken": bootstrap.csrftoken,
    "X-IG-App-ID": WEB_APP_ID,
    "X-Requested-With": "XMLHttpRequest",
    "X-Instagram-AJAX": "1",
    Origin: "https://www.instagram.com",
    Referer: "https://www.instagram.com/accounts/login/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Cookie: `csrftoken=${bootstrap.csrftoken}; mid=${bootstrap.mid}`,
  };
}

/** Interprets a login/2FA response body + resulting cookie jar. */
function interpretLogin(
  body: string,
  cookies: Record<string, string>,
  username: string,
  bootstrap: LoginBootstrap
): LoginResult {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(body);
  } catch {
    return { status: "error", message: "Instagram returned an unreadable response." };
  }

  if (data.authenticated === true && cookies.sessionid) {
    return {
      status: "authenticated",
      cookies,
      userId: String(data.userId ?? cookies.ds_user_id ?? ""),
    };
  }
  if (data.two_factor_required === true) {
    const info = (data.two_factor_info ?? {}) as Record<string, unknown>;
    return {
      status: "two_factor_required",
      twoFactorIdentifier: String(info.two_factor_identifier ?? ""),
      username,
      // Carried forward because the in-memory cookie jar won't survive to the
      // next stateless request; the 2FA submit re-sends these explicitly.
      bootstrap,
    };
  }
  const message = String(data.message ?? "");
  if (data.checkpoint_url || /checkpoint|challenge/i.test(message) || data.error_type === "checkpoint_challenge_required") {
    return {
      status: "checkpoint_required",
      message:
        "Instagram wants to verify this login with a checkpoint. Log in once in a real browser to clear it, then add the session by pasting cookies.",
    };
  }
  if (data.authenticated === false) {
    return {
      status: "bad_credentials",
      message: data.user === false ? "No Instagram account with that username." : "Incorrect username or password.",
    };
  }
  return { status: "error", message: message || "Login failed for an unknown reason." };
}

/**
 * Step 1: bootstrap + submit username/password.
 * `sessionId` pins the cookie jar so the bootstrap's csrftoken/mid ride along
 * on the submit within this call.
 */
export async function instagramLogin(params: {
  username: string;
  password: string;
  proxyUrl?: string | null;
  userAgent?: string | null;
}): Promise<LoginResult> {
  const ua = params.userAgent || CHROME_UA;
  const jar = `login-${params.username.toLowerCase()}-${Date.now()}`;

  try {
    // Bootstrap: a real browser loads the login page first; this yields the
    // csrftoken (and mid) the POST must echo back.
    const boot = await tlsRequestRaw({
      url: "https://www.instagram.com/accounts/login/",
      headers: {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      proxyUrl: params.proxyUrl,
      sessionId: jar,
    });
    const bootstrap: LoginBootstrap = {
      csrftoken: boot.cookies.csrftoken ?? "",
      mid: boot.cookies.mid ?? "",
    };
    if (!bootstrap.csrftoken) {
      return { status: "error", message: "Could not obtain a login token from Instagram (it may be rate-limiting this IP)." };
    }

    // Small human-ish gap between loading the page and submitting.
    await new Promise((r) => setTimeout(r, 600 + Math.floor(Math.random() * 900)));

    const body = new URLSearchParams({
      username: params.username,
      enc_password: encodePassword(params.password),
      queryParams: "{}",
      optIntoOneTap: "false",
    }).toString();

    const res = await tlsRequestRaw({
      url: LOGIN_URL,
      method: "POST",
      headers: loginHeaders(bootstrap, ua),
      body,
      proxyUrl: params.proxyUrl,
      sessionId: jar,
    });

    if (res.status === 429) {
      return { status: "error", message: "Instagram is rate-limiting this IP. Try again later or use a different proxy." };
    }
    return interpretLogin(res.body, res.cookies, params.username, bootstrap);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("PROXY_AUTH_FAILED")) {
      return { status: "error", message: "Proxy authentication failed (407). Check the proxy credentials." };
    }
    return { status: "error", message: msg };
  }
}

/** Step 2 (only if step 1 returned two_factor_required): submit the code. */
export async function instagramSubmitTwoFactor(params: {
  username: string;
  code: string;
  twoFactorIdentifier: string;
  bootstrap: LoginBootstrap;
  proxyUrl?: string | null;
  userAgent?: string | null;
}): Promise<LoginResult> {
  const ua = params.userAgent || CHROME_UA;
  try {
    const body = new URLSearchParams({
      username: params.username,
      verificationCode: params.code.replace(/\s+/g, ""),
      identifier: params.twoFactorIdentifier,
      queryParams: "{}",
    }).toString();

    const res = await tlsRequestRaw({
      url: TWO_FACTOR_URL,
      method: "POST",
      headers: loginHeaders(params.bootstrap, ua),
      body,
      proxyUrl: params.proxyUrl,
      sessionId: `2fa-${params.username.toLowerCase()}-${Date.now()}`,
    });

    const result = interpretLogin(res.body, res.cookies, params.username, params.bootstrap);
    if (result.status === "bad_credentials") {
      return { status: "bad_credentials", message: "That verification code was rejected. Request a new one and try again." };
    }
    return result;
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
