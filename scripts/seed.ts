/**
 * Seed 5 demo sites (idempotent — safe to run again):
 *   - 2 real public sites (healthy path)
 *   - 1 site pointing at the dev test target returning HTTP 500 (failure path)
 *   - 1 dev test target with SEO problems (noindex + staging canonical)
 *   - 1 dev test target for browser/links/form checks (JS error, 404 link, failing form)
 *
 *   pnpm seed
 */
import { loadRootEnv } from "@siteguard/core/env";
import { normalizeSiteUrl, siteInputSchema, type SiteInput } from "@siteguard/core";
import { connectDb, disconnectDb, getSettings, JobState, Site, syncSiteJobs } from "@siteguard/db";

loadRootEnv();
const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const DEMO_SITES: SiteInput[] = [
  {
    name: "Example Domain",
    url: "https://example.com",
    clientName: "Demo Client",
    tags: ["demo", "static"],
    framework: "html",
    notes: "IANA example site — should always be up.",
    content: { requiredKeyword: "Example Domain", extraSpamWords: [] },
  },
  {
    name: "Wikipedia",
    url: "https://www.wikipedia.org",
    clientName: "Demo Client",
    tags: ["demo"],
    notes: "Important page /wiki/Main_Page redirects to en.wikipedia.org (shows the redirect chain).",
    content: { requiredKeyword: "Wikipedia", extraSpamWords: [] },
    importantPages: ["/wiki/Main_Page"],
  },
  {
    name: "Broken Demo (HTTP 500)",
    url: `${appUrl}/api/dev/test-target?status=500`,
    clientName: "Test Lab",
    tags: ["demo", "test"],
    notes: "Dev test target — fails on purpose so the failure path (re-checks → DOWN) is visible. Needs `pnpm dev` running.",
  },
  {
    name: "SEO Broken Demo (noindex)",
    url: `${appUrl}/api/dev/test-target?noindex=meta&canonical=https://staging.example.com/`,
    clientName: "Test Lab",
    tags: ["demo", "test"],
    notes: "Dev test target with the classic launch mistakes: robots noindex + canonical to a staging domain. Needs `pnpm dev` running.",
  },
  {
    name: "Browser & Form Demo",
    url: `${appUrl}/api/dev/test-target?jserror=1&brokenlinks=1&form=fail`,
    clientName: "Test Lab",
    tags: ["demo", "test"],
    notes: "Dev test target for Phase 5: JavaScript error, a 404 link + image, and a contact form whose submission fails. Needs `pnpm dev` running.",
    checks: { form: { enabled: true } },
    form: { pageUrl: "", selector: "form", testSubmission: true, successText: "Thank you for your message" },
  },
];

await connectDb();
const settings = await getSettings();

for (const input of DEMO_SITES) {
  const data = siteInputSchema.parse(input);
  const existing = await Site.findOne({ url: normalizeSiteUrl(data.url) }).lean();
  const site = existing
    ? await Site.findByIdAndUpdate(existing._id, { $set: { name: data.name, tags: data.tags, notes: data.notes, content: data.content, importantPages: data.importantPages } }, { returnDocument: "after" }).lean()
    : (await Site.create({ ...data, createdBy: "seed" })).toObject();
  await syncSiteJobs(site!, settings);
  // Run right away instead of waiting for the random first-run spread.
  await JobState.updateMany({ siteId: site!._id, enabled: true }, { $set: { nextRunAt: new Date() } });
  console.log(`${existing ? "↺ updated" : "✔ created"}  ${data.name.padEnd(26)} ${data.url}`);
}

console.log("\nDone. With `pnpm dev` running, results appear within a few seconds.");
await disconnectDb();
