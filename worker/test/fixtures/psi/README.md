PageSpeed Insights v5 fixtures for `worker/test/pagespeed.test.ts` (tests never call Google).

- `429-keyless-quota.json` — **real** response captured 2026-09-24 from a keyless call (shared quota exhausted).
- `mobile-ok.json` / `desktop-ok.json` — v5 responses trimmed to the fields SiteGuard reads (categories, key audits, opportunities, CrUX loadingExperience). Real responses are ~500 KB.
- `runtime-error.json` — 200 response with `lighthouseResult.runtimeError` (page could not be loaded).
- `500-unreachable.json`, `400-bad-key.json` — error bodies in Google's standard format.
