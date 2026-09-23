export type DeliveryErrorKind =
  | "auth"
  | "ip_not_authorized"
  | "sender"
  | "invalid"
  | "quota"
  | "permission"
  | "rate_limit"
  | "server"
  | "network"
  | "chat_not_found"
  | "bot_blocked"
  | "not_configured";

const RETRYABLE: DeliveryErrorKind[] = ["rate_limit", "server", "network"];

/** A classified email/Telegram failure with an actionable hint for the Settings page. */
export class DeliveryError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly channel: "email" | "telegram",
    readonly kind: DeliveryErrorKind,
    message: string,
    readonly hint: string,
    readonly status?: number,
    /** Seconds the provider asked us to wait (Telegram retry_after / Retry-After). */
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "DeliveryError";
    this.retryable = RETRYABLE.includes(kind);
  }

  toJSON() {
    return { channel: this.channel, kind: this.kind, message: this.message, hint: this.hint, status: this.status };
  }
}

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry retryable DeliveryErrors (429 / 5xx / network) with backoff, honouring
 * the provider's retry-after (capped). Non-retryable errors throw immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: { attempts?: number; baseDelayMs?: number; maxDelayMs?: number; sleep?: Sleep } = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  const max = opts.maxDelayMs ?? 30_000;
  const sleep = opts.sleep ?? realSleep;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof DeliveryError) || !err.retryable || i >= attempts) throw err;
      const wait = err.retryAfterSec != null ? err.retryAfterSec * 1000 : base * 3 ** (i - 1);
      await sleep(Math.min(wait, max));
    }
  }
}
