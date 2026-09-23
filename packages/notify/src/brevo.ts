import { DeliveryError, withRetry, type Sleep } from "./errors";
import type { EmailProvider } from "./provider";

/**
 * Brevo transactional email API v3.
 * POST https://api.brevo.com/v3/smtp/email   (header: api-key) → 201 { messageId }
 * Errors: { code, message } — e.g. 401 "Key not found", 401 "unrecognised IP address…",
 * 400 invalid_parameter, 402 not_enough_credits, 429 too many requests.
 */
export const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";

export interface BrevoEmail {
  sender: { name: string; email: string };
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
  textContent?: string;
  tags?: string[];
  headers?: Record<string, string>;
}

export interface BrevoClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
  sleep?: Sleep;
  timeoutMs?: number;
  attempts?: number;
}

export const BREVO_HINTS = {
  ip_not_authorized:
    "Brevo blocked this server's IP address. In Brevo go to Settings → Security → Authorized IPs and add your server's public IP (or click the link in Brevo's “Validate your IP address” email), then send the test again.",
  auth: "Brevo rejected the API key. Create a v3 API key in Brevo → SMTP & API → API Keys and put it in BREVO_API_KEY.",
  sender: "Brevo rejected the sender. Add and verify ALERT_FROM_EMAIL (and authenticate its domain with SPF + DKIM) in Brevo → Senders, Domains & Dedicated IPs.",
  quota: "Brevo reports no email credits left (free plan: 300 emails/day). Alerts continue on Telegram and in-app.",
  permission: "Brevo denied the request. The account may still be under validation or the API key lacks permissions.",
  rate_limit: "Brevo rate limit hit; SiteGuard retried automatically.",
  server: "Brevo had a server error; SiteGuard retried automatically. Check status.brevo.com if it persists.",
  network: "Could not reach api.brevo.com (DNS / outbound HTTPS blocked?). Check the server's internet access.",
  invalid: "Brevo rejected the request as invalid. See the error message for the field.",
} as const;

export function classifyBrevoError(status: number, body: { code?: string; message?: string } | null, retryAfterSec?: number): DeliveryError {
  const msg = body?.message ?? `HTTP ${status}`;
  const code = body?.code ?? "";
  const make = (kind: keyof typeof BREVO_HINTS) => new DeliveryError("email", kind, `Brevo ${status}${code ? ` ${code}` : ""}: ${msg}`, BREVO_HINTS[kind], status, retryAfterSec);

  if (status === 401 || status === 403) {
    if (/unrecogni[sz]ed ip|authori[sz]ed_?ips|ip address/i.test(msg)) return make("ip_not_authorized");
    return status === 401 ? make("auth") : make("permission");
  }
  if (status === 402 || code === "not_enough_credits") return make("quota");
  if (status === 429) return make("rate_limit");
  if (status >= 500) return make("server");
  if (/sender/i.test(msg)) return make("sender");
  return make("invalid");
}

export class BrevoClient implements EmailProvider {
  readonly name = "brevo";
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: BrevoClientOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch;
  }

  /** Sends one email; returns Brevo's messageId. Retries 429/5xx/network. */
  async send(email: BrevoEmail): Promise<{ messageId: string }> {
    return withRetry(() => this.once(email), { sleep: this.opts.sleep, attempts: this.opts.attempts });
  }

  private async once(email: BrevoEmail): Promise<{ messageId: string }> {
    let res: Response;
    try {
      res = await this.fetch(BREVO_SEND_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "api-key": this.opts.apiKey,
        },
        body: JSON.stringify(email),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
      });
    } catch (err) {
      throw new DeliveryError("email", "network", `Brevo network error: ${(err as Error).message}`, BREVO_HINTS.network);
    }

    const body = (await res.json().catch(() => null)) as { messageId?: string; code?: string; message?: string } | null;
    if (res.ok) return { messageId: body?.messageId ?? "" };
    const retryAfter = Number(res.headers.get("retry-after")) || undefined;
    throw classifyBrevoError(res.status, body, retryAfter);
  }
}
