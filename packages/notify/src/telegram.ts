import { DeliveryError, withRetry, type Sleep } from "./errors";

/**
 * Telegram Bot API: POST https://api.telegram.org/bot<token>/sendMessage (JSON).
 * Response: { ok: true, result: Message } | { ok: false, error_code, description, parameters?: { retry_after } }
 */
export const TELEGRAM_API = "https://api.telegram.org";
/** Telegram rejects messages longer than this (after entity parsing). */
export const TELEGRAM_MAX_LENGTH = 4096;

export interface TelegramPayload {
  chat_id: string;
  text: string;
  parse_mode: "HTML";
  link_preview_options: { is_disabled: true };
  disable_notification?: boolean;
}

export function buildTelegramPayload(chatId: string, text: string, silent = false): TelegramPayload {
  return {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(silent ? { disable_notification: true } : {}),
  };
}

export const TELEGRAM_HINTS = {
  auth: "Telegram rejected the bot token. Get the token from @BotFather (/mybots → API Token) and set TELEGRAM_BOT_TOKEN.",
  chat_not_found:
    "Chat not found. Check TELEGRAM_CHAT_ID, and make sure you sent /start to the bot (or added the bot to the group) — bots can't message chats they were never added to.",
  bot_blocked: "The bot was blocked by the user or removed from the group. Unblock / re-add the bot, then send the test again.",
  invalid: "Telegram rejected the message format. See the error message.",
  rate_limit: "Telegram rate limit hit; SiteGuard waited and retried.",
  server: "Telegram had a server error; SiteGuard retried automatically.",
  network: "Could not reach api.telegram.org. Check the server's outbound internet access.",
} as const;

export function classifyTelegramError(status: number, body: { error_code?: number; description?: string; parameters?: { retry_after?: number } } | null): DeliveryError {
  const desc = body?.description ?? `HTTP ${status}`;
  const code = body?.error_code ?? status;
  const make = (kind: keyof typeof TELEGRAM_HINTS, retryAfter?: number) =>
    new DeliveryError("telegram", kind, `Telegram ${code}: ${desc}`, TELEGRAM_HINTS[kind], status, retryAfter);

  if (code === 401 || code === 404) return make("auth");
  if (code === 429) return make("rate_limit", body?.parameters?.retry_after ?? 5);
  if (code >= 500) return make("server");
  if (code === 403) return make("bot_blocked");
  if (/chat not found|chat_id is empty|user not found/i.test(desc)) return make("chat_not_found");
  return make("invalid");
}

export interface TelegramClientOptions {
  botToken: string;
  fetch?: typeof fetch;
  sleep?: Sleep;
  timeoutMs?: number;
  attempts?: number;
}

export class TelegramClient {
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: TelegramClientOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch;
  }

  async sendMessage(chatId: string, text: string, silent = false): Promise<{ messageId: number }> {
    return withRetry(() => this.once(buildTelegramPayload(chatId, text, silent)), { sleep: this.opts.sleep, attempts: this.opts.attempts });
  }

  private async once(payload: TelegramPayload): Promise<{ messageId: number }> {
    let res: Response;
    try {
      res = await this.fetch(`${TELEGRAM_API}/bot${this.opts.botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
      });
    } catch (err) {
      // Never leak the token (it is part of the URL) into logs/UI.
      const msg = String((err as Error).message).replaceAll(this.opts.botToken, "<token>");
      throw new DeliveryError("telegram", "network", `Telegram network error: ${msg}`, TELEGRAM_HINTS.network);
    }
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: { message_id: number }; error_code?: number; description?: string; parameters?: { retry_after?: number } } | null;
    if (res.ok && body?.ok) return { messageId: body.result?.message_id ?? 0 };
    throw classifyTelegramError(res.status, body);
  }
}
