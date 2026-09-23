/**
 * Seed 3 demo sites (idempotent — safe to run again):
 *   - 2 real public sites (healthy path)
 *   - 1 site pointing at the dev test target returning HTTP 500 (failure path)
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
