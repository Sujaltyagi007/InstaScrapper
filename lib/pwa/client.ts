/**
 * Browser-side PWA helpers: install prompt capture, service worker registration,
 * and push subscription. Only imported by client components.
 */

/** Chrome/Edge/Samsung's install prompt event (not in the TS DOM lib). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type InstallState = { prompt: BeforeInstallPromptEvent | null; installed: boolean };

const INSTALLED_KEY = "pwaInstalled";

/** Best-effort: private browsing / blocked storage can throw on either call. */
function readInstalledFlag(): boolean {
  try {
    return localStorage.getItem(INSTALLED_KEY) === "1";
  } catch {
    return false;
  }
}
function writeInstalledFlag() {
  try {
    localStorage.setItem(INSTALLED_KEY, "1");
  } catch {
    // ignore — worst case the button reappears next visit
  }
}

// `installed` seeds from localStorage so the button stays gone across reloads and other
// tabs on this device/browser — `appinstalled` only fires once, in the tab that triggered
// the install, and in-memory state alone would forget it on the next page load.
let installState: InstallState = { prompt: null, installed: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// Registered as soon as this module loads, so the event isn't missed before React mounts.
if (typeof window !== "undefined") {
  installState.installed = readInstalledFlag();
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own "Install app" button instead of the mini-infobar
    installState = { ...installState, prompt: e as BeforeInstallPromptEvent };
    emit();
  });
  window.addEventListener("appinstalled", () => {
    writeInstalledFlag();
    installState = { prompt: null, installed: true };
    emit();
  });
  // Opening from the Home Screen / installed window is itself proof of an install —
  // covers the case where `appinstalled` never fired in this browser (e.g. installed
  // via a different tab, or a browser that doesn't fire the event reliably).
  if (isStandalone()) writeInstalledFlag();
}

export const installStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => installState,
  getServerSnapshot: () => installState,
};

/** Shows the browser's install dialog. Resolves true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = installState.prompt;
  if (!e) return false;
  await e.prompt();
  const { outcome } = await e.userChoice;
  installState = { ...installState, prompt: null }; // a prompt can only be used once
  emit();
  return outcome === "accepted";
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports itself as Mac; touch support tells them apart.
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  // Secure context only (https, or localhost in development).
  if (!window.isSecureContext) return null;
  return navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Subscribes this browser (permission must already be granted). */
export async function subscribeThisDevice(publicKey: string): Promise<PushSubscription> {
  const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await registerServiceWorker());
  if (!reg) throw new Error("This browser can't receive notifications here.");
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToUint8Array(publicKey) });
}
