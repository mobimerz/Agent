import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { DEFAULT_THRESHOLDS } from "@siteguard/core";
import type { SettingsDoc, SiteLean } from "@siteguard/db";
import { Types } from "@siteguard/db";
import pino from "pino";
import type { NotifyConfig } from "@siteguard/notify";
import type { CheckContext } from "../src/checks/types";

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** Tiny local HTTP server; routes by pathname. */
export async function startServer(routes: Record<string, Handler>): Promise<{ url: string; server: Server; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const h = routes[path];
    if (h) h(req, res);
    else {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

export const silentLog = pino({ level: "silent" });

export function makeSite(url: string, extra: Partial<SiteLean> = {}): SiteLean {
  return {
    _id: new Types.ObjectId(),
    name: "Test",
    url,
    status: "active",
    importantPages: [],
    content: { requiredKeyword: "", extraSpamWords: [] },
    thresholds: {},
    checks: {},
    ...extra,
  } as unknown as SiteLean;
}

export function makeCtx(extra: Partial<CheckContext> = {}): CheckContext {
  return {
    settings: {} as SettingsDoc,
    thresholds: { ...DEFAULT_THRESHOLDS },
    jobData: {},
    log: silentLog,
    timeoutMs: 2000,
    ...extra,
  };
}

/** Preview-mode notify config (no real sends in tests). */
export const testNotifyConfig: NotifyConfig = {
  appUrl: "http://localhost:3000",
  timeZone: "Asia/Kolkata",
  dryRun: true,
  fromName: "SiteGuard",
  fromEmail: "alerts@mycompany.com",
  envAlertEmails: ["team@mycompany.com"],
  envTelegramChatIds: ["-1001"],
};
