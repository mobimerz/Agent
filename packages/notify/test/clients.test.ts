import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BREVO_SEND_URL, BrevoClient, DeliveryError, TelegramClient, type BrevoEmail } from "../src";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const noSleep = async () => {};
const sleeps: number[] = [];
const recordSleep = async (ms: number) => {
  sleeps.push(ms);
};

const email: BrevoEmail = {
  sender: { name: "SiteGuard", email: "alerts@mycompany.com" },
  to: [{ email: "team@mycompany.com" }],
  subject: "🔴 CRITICAL: Site down — Acme",
  htmlContent: "<p>down</p>",
  textContent: "down",
  tags: ["siteguard", "alert"],
};

async function catchErr(p: Promise<unknown>): Promise<DeliveryError> {
  try {
    await p;
  } catch (e) {
    return e as DeliveryError;
  }
  throw new Error("expected rejection");
}

describe("BrevoClient (POST /v3/smtp/email)", () => {
  it("sends the exact documented request and returns messageId", async () => {
    let captured: { url: string; method: string; headers: Record<string, string>; body: unknown } | undefined;
    server.use(
      http.post(BREVO_SEND_URL, async ({ request }) => {
        captured = { url: request.url, method: request.method, headers: Object.fromEntries(request.headers), body: await request.json() };
        return HttpResponse.json({ messageId: "<202609231200.123@smtp-relay.mailin.fr>" }, { status: 201 });
      }),
    );
    const res = await new BrevoClient({ apiKey: "xkeysib-test", sleep: noSleep }).send(email);

    expect(res.messageId).toBe("<202609231200.123@smtp-relay.mailin.fr>");
    expect(captured!.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(captured!.method).toBe("POST");
    expect(captured!.headers["api-key"]).toBe("xkeysib-test");
    expect(captured!.headers["content-type"]).toBe("application/json");
    expect(captured!.headers["accept"]).toBe("application/json");
    expect(captured!.body).toEqual({
      sender: { name: "SiteGuard", email: "alerts@mycompany.com" },
      to: [{ email: "team@mycompany.com" }],
      subject: "🔴 CRITICAL: Site down — Acme",
      htmlContent: "<p>down</p>",
      textContent: "down",
      tags: ["siteguard", "alert"],
    });
  });

  it("401 Key not found → auth error, not retried", async () => {
    let calls = 0;
    server.use(
      http.post(BREVO_SEND_URL, () => {
        calls++;
        return HttpResponse.json({ code: "unauthorized", message: "Key not found" }, { status: 401 });
      }),
    );
    const err = await catchErr(new BrevoClient({ apiKey: "bad", sleep: noSleep }).send(email));
    expect(err).toBeInstanceOf(DeliveryError);
    expect(err.kind).toBe("auth");
    expect(err.status).toBe(401);
    expect(err.hint).toMatch(/API Keys/);
    expect(calls).toBe(1);
  });

  it("401 unrecognised IP → ip_not_authorized with the whitelist hint", async () => {
    server.use(
      http.post(BREVO_SEND_URL, () =>
        HttpResponse.json(
          {
            code: "unauthorized",
            message:
              "We have detected you are using an unrecognised IP address 140.238.1.2. If you performed this action make sure to add the new IP address in this link: https://app.brevo.com/security/authorised_ips",
          },
          { status: 401 },
        ),
      ),
    );
    const err = await catchErr(new BrevoClient({ apiKey: "k", sleep: noSleep }).send(email));
    expect(err.kind).toBe("ip_not_authorized");
    expect(err.hint).toMatch(/Authorized IPs/);
    expect(err.retryable).toBe(false);
  });

  it("400 invalid sender → sender hint", async () => {
    server.use(http.post(BREVO_SEND_URL, () => HttpResponse.json({ code: "invalid_parameter", message: "sender is invalid / inactive" }, { status: 400 })));
    const err = await catchErr(new BrevoClient({ apiKey: "k", sleep: noSleep }).send(email));
    expect(err.kind).toBe("sender");
    expect(err.hint).toMatch(/SPF \+ DKIM/);
  });

  it("402 not_enough_credits → quota", async () => {
    server.use(http.post(BREVO_SEND_URL, () => HttpResponse.json({ code: "not_enough_credits", message: "Not enough credits" }, { status: 402 })));
    expect((await catchErr(new BrevoClient({ apiKey: "k", sleep: noSleep }).send(email))).kind).toBe("quota");
  });

  it("429 → retried with backoff, then succeeds", async () => {
    sleeps.length = 0;
    let calls = 0;
    server.use(
      http.post(BREVO_SEND_URL, () => {
        calls++;
        return calls < 3
          ? HttpResponse.json({ code: "too_many_requests", message: "Too many requests" }, { status: 429 })
          : HttpResponse.json({ messageId: "m1" }, { status: 201 });
      }),
    );
    const res = await new BrevoClient({ apiKey: "k", sleep: recordSleep }).send(email);
    expect(res.messageId).toBe("m1");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([1000, 3000]);
  });

  it("5xx on every attempt → server error after 3 tries", async () => {
    let calls = 0;
    server.use(
      http.post(BREVO_SEND_URL, () => {
        calls++;
        return HttpResponse.json({ message: "Internal error" }, { status: 503 });
      }),
    );
    const err = await catchErr(new BrevoClient({ apiKey: "k", sleep: noSleep }).send(email));
    expect(err.kind).toBe("server");
    expect(calls).toBe(3);
  });

  it("network error → classified, retried, then network error", async () => {
    let calls = 0;
    server.use(
      http.post(BREVO_SEND_URL, () => {
        calls++;
        return HttpResponse.error();
      }),
    );
    const err = await catchErr(new BrevoClient({ apiKey: "k", sleep: noSleep }).send(email));
    expect(err.kind).toBe("network");
    expect(calls).toBe(3);
  });
});

describe("TelegramClient (sendMessage, HTML parse mode)", () => {
  const TOKEN = "123456:ABC-test_token";
  const URL = `https://api.telegram.org/bot${TOKEN}/sendMessage`;

  it("sends the exact documented request", async () => {
    let captured: { headers: Record<string, string>; body: unknown } | undefined;
    server.use(
      http.post(URL, async ({ request }) => {
        captured = { headers: Object.fromEntries(request.headers), body: await request.json() };
        return HttpResponse.json({ ok: true, result: { message_id: 42, chat: { id: -1001 }, date: 0, text: "x" } });
      }),
    );
    const res = await new TelegramClient({ botToken: TOKEN, sleep: noSleep }).sendMessage("-1001234567890", "🔴 <b>DOWN</b> · Acme");
    expect(res.messageId).toBe(42);
    expect(captured!.headers["content-type"]).toBe("application/json");
    expect(captured!.body).toEqual({
      chat_id: "-1001234567890",
      text: "🔴 <b>DOWN</b> · Acme",
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  it("401 → auth (bad bot token), not retried", async () => {
    let calls = 0;
    server.use(
      http.post(URL, () => {
        calls++;
        return HttpResponse.json({ ok: false, error_code: 401, description: "Unauthorized" }, { status: 401 });
      }),
    );
    const err = await catchErr(new TelegramClient({ botToken: TOKEN, sleep: noSleep }).sendMessage("1", "x"));
    expect(err.kind).toBe("auth");
    expect(err.hint).toMatch(/BotFather/);
    expect(calls).toBe(1);
  });

  it("400 chat not found → chat_not_found hint", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ ok: false, error_code: 400, description: "Bad Request: chat not found" }, { status: 400 })));
    const err = await catchErr(new TelegramClient({ botToken: TOKEN, sleep: noSleep }).sendMessage("1", "x"));
    expect(err.kind).toBe("chat_not_found");
    expect(err.hint).toMatch(/\/start/);
  });

  it("403 blocked by user → bot_blocked", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, { status: 403 })));
    expect((await catchErr(new TelegramClient({ botToken: TOKEN, sleep: noSleep }).sendMessage("1", "x"))).kind).toBe("bot_blocked");
  });

  it("429 → honours parameters.retry_after, then succeeds", async () => {
    sleeps.length = 0;
    let calls = 0;
    server.use(
      http.post(URL, () => {
        calls++;
        return calls === 1
          ? HttpResponse.json({ ok: false, error_code: 429, description: "Too Many Requests: retry after 7", parameters: { retry_after: 7 } }, { status: 429 })
          : HttpResponse.json({ ok: true, result: { message_id: 7 } });
      }),
    );
    const res = await new TelegramClient({ botToken: TOKEN, sleep: recordSleep }).sendMessage("1", "x");
    expect(res.messageId).toBe(7);
    expect(sleeps).toEqual([7000]);
  });

  it("network error → network kind, token never appears in the message", async () => {
    server.use(http.post(URL, () => HttpResponse.error()));
    const err = await catchErr(new TelegramClient({ botToken: TOKEN, sleep: noSleep }).sendMessage("1", "x"));
    expect(err.kind).toBe("network");
    expect(err.message).not.toContain(TOKEN);
  });
});
