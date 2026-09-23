// Executed by email-runtime.test.ts through the real `tsx` CLI (the worker's runtime).
import { renderAlertEmail } from "@siteguard/emails";

const r = await renderAlertEmail(
  { type: "opened", severity: "CRITICAL", title: "Site is down", message: "HTTP 503", link: "http://x/sites/1", siteName: "Acme" },
  "Asia/Kolkata",
);
console.log(JSON.stringify({ subject: r.subject, ok: r.html.includes("Acme") }));
