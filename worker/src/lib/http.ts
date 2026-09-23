import { USER_AGENT, type CheckReason } from "@siteguard/core";

export interface RedirectHop {
  url: string;
  status: number;
}

export interface HttpSuccess {
  ok: true;
  status: number;
  headers: Headers;
  /** URL of the final (non-redirect) response. */
  finalUrl: string;
  redirects: RedirectHop[];
  /** Time from the first request until the final response's headers arrived (incl. redirects). */
  responseTimeMs: number;
  /** Time to first byte of the final hop only. */
  ttfbMs: number;
  /** Total time including reading the (possibly truncated) body. */
  totalMs: number;
  body: string;
  bytes: number;
  truncated: boolean;
}

export interface HttpFailure {
  ok: false;
  reason: Extract<CheckReason, "dns" | "refused" | "timeout" | "ssl" | "reset" | "network" | "too_many_redirects">;
  /** Low-level code, e.g. ENOTFOUND, CERT_HAS_EXPIRED. */
  code: string;
  message: string;
  url: string;
  redirects: RedirectHop[];
  elapsedMs: number;
}

export type HttpResult = HttpSuccess | HttpFailure;

export interface HttpGetOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  /** Stop reading the body after this many bytes (the connection is then closed). */
  maxBodyBytes?: number;
}

const DEFAULTS = { timeoutMs: 30_000, maxRedirects: 5, maxBodyBytes: 512 * 1024 };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * GET a URL like a browser would (GET, not HEAD — many servers reject HEAD),
 * following up to `maxRedirects` redirects manually so every hop is recorded.
 * Never throws: network errors are classified into a `reason`.
 */
export async function httpGet(url: string, options: HttpGetOptions = {}): Promise<HttpResult> {
  const { timeoutMs, maxRedirects, maxBodyBytes } = { ...DEFAULTS, ...options };
  const signal = AbortSignal.timeout(timeoutMs);
  const started = performance.now();
  const redirects: RedirectHop[] = [];
  let current = url;

  try {
    for (let hop = 0; ; hop++) {
      const hopStart = performance.now();
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-IN,en;q=0.9",
          "cache-control": "no-cache",
        },
      });
      const headersAt = performance.now();
      const location = res.headers.get("location");

      if (REDIRECT_STATUSES.has(res.status) && location) {
        await res.body?.cancel().catch(() => {});
        redirects.push({ url: current, status: res.status });
        if (hop >= maxRedirects) {
          return {
            ok: false,
            reason: "too_many_redirects",
            code: "TOO_MANY_REDIRECTS",
            message: `More than ${maxRedirects} redirects`,
            url: current,
            redirects,
            elapsedMs: Math.round(performance.now() - started),
          };
        }
        current = new URL(location, current).toString();
        continue;
      }

      const { text, bytes, truncated } = await readBody(res, maxBodyBytes);
      return {
        ok: true,
        status: res.status,
        headers: res.headers,
        finalUrl: current,
        redirects,
        responseTimeMs: Math.round(headersAt - started),
        ttfbMs: Math.round(headersAt - hopStart),
        totalMs: Math.round(performance.now() - started),
        body: text,
        bytes,
        truncated,
      };
    }
  } catch (err) {
    const { reason, code, message } = classifyNetworkError(err);
    return { ok: false, reason, code, message, url: current, redirects, elapsedMs: Math.round(performance.now() - started) };
  }
}

async function readBody(res: Response, maxBytes: number): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (!res.body) return { text: "", bytes: 0, truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      chunks.push(value.subarray(0, value.byteLength - (bytes - maxBytes)));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
  return { text, bytes, truncated };
}

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NODATA", "EAI_NONAME", "EAI_FAIL"]);
const TIMEOUT_CODES = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
const RESET_CODES = new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET", "ECONNABORTED"]);
const NETWORK_CODES = new Set(["EHOSTUNREACH", "ENETUNREACH", "EHOSTDOWN", "ENETDOWN"]);

function isSslCode(code: string): boolean {
  return (
    code.startsWith("CERT_") ||
    code.startsWith("ERR_TLS_") ||
    code.startsWith("ERR_SSL_") ||
    code.includes("SELF_SIGNED") ||
    code.startsWith("UNABLE_TO_") ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "HOSTNAME_MISMATCH" ||
    code === "EPROTO"
  );
}

/** Dig the most specific error code out of fetch's wrapped errors. */
function extractCode(err: unknown): { code: string; message: string } {
  let e: unknown = err;
  for (let depth = 0; depth < 5 && e; depth++) {
    const obj = e as { code?: unknown; message?: string; cause?: unknown; errors?: unknown[]; name?: string };
    if (typeof obj.code === "string" && obj.code) return { code: obj.code, message: obj.message ?? obj.code };
    if (obj.name === "TimeoutError") return { code: "TIMEOUT", message: "Request timed out" };
    if (Array.isArray(obj.errors) && obj.errors.length) e = obj.errors[0];
    else e = obj.cause;
  }
  const top = err as { name?: string; message?: string };
  if (top?.name === "TimeoutError" || top?.name === "AbortError") return { code: "TIMEOUT", message: "Request timed out" };
  return { code: "UNKNOWN", message: top?.message ?? String(err) };
}

export function classifyNetworkError(err: unknown): Pick<HttpFailure, "reason" | "code" | "message"> {
  const { code, message } = extractCode(err);
  if (DNS_CODES.has(code)) return { reason: "dns", code, message: "DNS lookup failed (domain does not resolve)" };
  if (code === "ECONNREFUSED") return { reason: "refused", code, message: "Connection refused" };
  if (code === "TIMEOUT" || TIMEOUT_CODES.has(code)) return { reason: "timeout", code, message: "Timed out waiting for the server" };
  if (isSslCode(code)) return { reason: "ssl", code, message: `SSL/TLS error: ${code}` };
  if (RESET_CODES.has(code)) return { reason: "reset", code, message: "Connection reset by the server" };
  if (NETWORK_CODES.has(code)) return { reason: "network", code, message: `Network unreachable (${code})` };
  return { reason: "network", code, message };
}
