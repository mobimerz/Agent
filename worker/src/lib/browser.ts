import { chromium, type Browser, type BrowserContext } from "playwright";
import { USER_AGENT } from "@siteguard/core";

/** Real Chrome UA + our marker, so sites render normally but can still whitelist us. */
export const BROWSER_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 ${USER_AGENT}`;

/** Close Chromium after this long without work (frees ~150–300 MB on the small VM). */
const IDLE_CLOSE_MS = 5 * 60_000;

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let active = 0;

export class BrowserUnavailableError extends Error {}

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  launching ??= chromium
    .launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-first-run", "--mute-audio"] })
    .then((b) => {
      browser = b;
      b.on("disconnected", () => {
        if (browser === b) browser = null; // crashed or closed: relaunch on next use
      });
      return b;
    })
    .catch((err: Error) => {
      // Most common cause locally: `pnpm browsers:install` not run yet.
      throw new BrowserUnavailableError(/Executable doesn't exist|browserType\.launch/i.test(err.message) ? "Chromium is not installed — run `pnpm browsers:install`" : `Chromium failed to start: ${err.message.split("\n")[0]}`);
    })
    .finally(() => {
      launching = null;
    });
  return launching;
}

export interface ContextOptions {
  viewport?: { width: number; height: number };
  isMobile?: boolean;
}

/**
 * Run `fn` in a fresh, isolated browser context (own cookies/cache), always
 * closed afterwards. The shared Chromium is launched on demand and closed when idle.
 */
export async function withBrowserContext<T>(fn: (ctx: BrowserContext) => Promise<T>, opts: ContextOptions = {}): Promise<T> {
  if (idleTimer) clearTimeout(idleTimer);
  active++;
  let context: BrowserContext | null = null;
  try {
    const b = await getBrowser();
    context = await b.newContext({
      userAgent: BROWSER_USER_AGENT,
      viewport: opts.viewport ?? { width: 1366, height: 768 },
      isMobile: opts.isMobile,
      ignoreHTTPSErrors: true, // certificate problems are the SSL check's job
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
    });
    // The worker runs under tsx/esbuild (keepNames), which wraps functions we pass to
    // page.evaluate() in `__name(fn, "…")` — a helper that doesn't exist in the page.
    await context.addInitScript({ content: "globalThis.__name ??= (fn) => fn;" });
    return await fn(context);
  } finally {
    await context?.close().catch(() => {});
    active--;
    if (active === 0) {
      idleTimer = setTimeout(() => void closeBrowser(), IDLE_CLOSE_MS);
      idleTimer.unref();
    }
  }
}

export async function closeBrowser(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  const b = browser;
  browser = null;
  await b?.close().catch(() => {});
}
