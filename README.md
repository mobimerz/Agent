# SiteGuard

Internal monitoring for client websites — uptime, speed, SEO, SSL, domain, forms and more — with alerts by email (Brevo), Telegram and in-app, plus daily morning/night reports. 100% free stack, self-hosted on one Oracle Cloud Always Free ARM VM.

> Status: **Phase 7 — complete.** Production deployment: [`docs/DEPLOY.md`](docs/DEPLOY.md) · accounts & keys: [`docs/GO-LIVE-CHECKLIST.md`](docs/GO-LIVE-CHECKLIST.md).

## What works today

- **Sites:** add / edit / pause / delete, per-site check toggles + intervals, slow threshold, important pages, required keyword. Bulk **CSV import** with a preview (valid / invalid with reason / duplicates) and a downloadable template.
- **Uptime / HTTP check** (every 5 min): real `GET` (never `HEAD`), up to 5 redirects with the full chain + final URL, 30 s timeout, TTFB. Exact failure reason: DNS failure, connection refused, timeout, SSL/TLS error, connection reset, HTTP 4xx, HTTP 5xx, too many redirects, slow (WARN), important page failing (WARN).
- **Bot protection ≠ downtime:** Cloudflare / Sucuri / Imperva / Wordfence / ModSecurity / Vercel challenges and 429s are reported as **BLOCKED (WARN)** with a whitelist hint, never as DOWN.
- **Content / defacement check** (every 30 min): required keyword, hack/spam words (visible text only), drastic page-size change vs a moving baseline. If the page is unreachable it reports UNKNOWN (the uptime check owns availability — no double alerts).
- **False-alarm protection:** a FAIL is re-checked twice, 60 s apart; the site is only marked **Down** after 3 consecutive failures. (`consecutiveFails` / `retryAttempt` live in `jobsState`; Phase 3 plugs the incident engine into `worker/src/incidents/hook.ts`.)
- **Scheduler:** croner tick every 3 s → atomic job claim in MongoDB → p-queue (HTTP ×10). Restart-safe, no duplicate runs.
- **Incidents & alerts:** incident opens after 3 failures (warnings after 2), resolves after **2** OKs, escalates/de-escalates in place, reminders every 2 h until acknowledged, flap detection (4+ changes in 30 min → one “unstable” alert, then silence), maintenance-window suppression. BLOCKED = WARNING via Telegram + in-app only; hacked/spam content = CRITICAL, always emailed.
- **Channels:** Brevo email (React Email templates) + Telegram (HTML, multiple chats) + in-app (MongoDB Change Stream → SSE bell, polling fallback). 5+ alerts in 10 min → one grouped email; Brevo quota guard (250/day, 10 reserved for reports, digest after 200).
- **Preview mode (`DRY_RUN=true`, default):** nothing is sent; every email/Telegram message is rendered and viewable at **/dev/emails** and **/dev/telegram**. Missing keys never crash anything — the channel just stays in preview.
- **Worker watchdog:** the web app raises a CRITICAL alert itself if the worker heartbeat is 15+ min old.
- **PageSpeed** (every 12 h, mobile + desktop via Google PSI): performance / SEO / accessibility / best-practice scores, lab Core Web Vitals, CrUX field data, top opportunities. Works **without an API key** (one run at a time, spaced out) and uses `PSI_API_KEY` automatically when set. HTTP 429 → run recorded as **“Skipped – rate limited”**, all PSI calls pause ~30 min, never a failure. Alerts use the **median of the last 3 runs** and need **2 consecutive runs** below the threshold.
- **SSL** (daily): expiry (warn 30 d / critical 7 d), hostname mismatch, **incomplete chain (missing intermediate)**, self-signed/untrusted; apex **and** www are both checked when both resolve.
- **Domain expiry** (daily): registrable domain from the Public Suffix List (`blog.client.co.in` → `client.co.in`), RDAP with WHOIS fallback, registrar + expiry date, cached per registrable domain (12 h; hourly near expiry). Platform subdomains (vercel.app, netlify.app, github.io, pages.dev, onrender.com…) show **“Managed by platform”**.
- **DNS** (daily): A/AAAA/CNAME (site host) + NS/MX (domain) compared **as sets** (order/TTL ignored) against a baseline. Cloudflare-aware (IP moves inside Cloudflare's ranges ignored, NS changes still alert), CNAME-aware (target IP rotation ignored). **Accept this change** makes the new records the baseline. System resolver with DNS-over-HTTPS fallback.
- **On-page SEO** (daily, homepage + important pages): noindex in the robots meta tag **and** the `X-Robots-Tag` header, robots.txt blocking `User-agent: *`, canonical pointing to another domain (staging/old), sitemap referenced in robots.txt and valid XML, title, description, H1, viewport, lang — shown as a pass/fail checklist with a “how to fix” hint per item.
- **Browser health** (daily, real headless Chromium via Playwright): uncaught JavaScript errors, own scripts/stylesheets failing to load, **blank page** detection (crashed JS app / hidden PHP fatal), load time, and a **screenshot** per run (last 7 kept per site). One browser job at a time; Chromium is closed after 5 idle minutes.
- **Contact form** (daily, opt-in per site): opens the form page in Chromium and checks the form, its fields and the submit button. **Test submission** (off by default — the client receives the email) fills `[SITEGUARD-TEST]` data (honeypot fields left empty), submits, and looks for the configured success text or common plugin messages (CF7, WPForms, Elementor, Gravity…). CAPTCHA forms are render-checked only. A failed test submission is **never re-submitted** every 60 s to confirm it.
- **Broken links** (weekly): crawls up to 50 pages (per-site override), checks links, images, scripts and stylesheets; internal vs external; 403/429/bot walls on other sites count as “couldn't verify”, not broken; admin/logout/cart URLs are never visited; redirecting internal links listed.
- **Security headers** (weekly): HSTS, CSP, clickjacking protection, nosniff, Referrer-Policy, Permissions-Policy, version disclosure → A–F grade + checklist with fixes. **Mixed content** (http scripts/styles on an https page, which browsers block) alerts on Telegram; missing headers are in-app only.
- **Daily reports** (09:00 and 21:00 in the configured timezone, editable): email + Telegram + in-app, with **what changed since the last report** (went down / recovered / degraded, new SSL or domain expiries within 30 days, performance drops, sites added/paused), incidents opened/resolved, open incidents, renewals due and every site's uptime for the period. Uses the report slice of the email quota; each report is sent exactly once, and one missed by 3+ hours (server down) is skipped rather than sent late. The **Reports** page keeps them for a year; admins can “Send … report now”.
- **History:** hourly uptime rollups (kept 1 year; raw results 30 days) → **90-day** status bar and uptime %. The first start backfills from the raw data.
- **Maintenance windows** per site (Incidents tab): checks keep running, alerts and reminders pause; a banner shows on the site page while active.
- **Settings → Alerts, reports & thresholds:** report times + channels, recipients (override .env), default thresholds, reminder interval. **Settings → System:** job status, retention, backups list, “Back up now”.
- **Backups:** nightly at 02:30 (worker) — gzip'd EJSON per collection + manifest, pruned after `BACKUP_KEEP_DAYS`. `pnpm db:backup` / `pnpm db:restore <name> --yes`; restore is covered by an automated backup → wipe → restore test.
- **Dashboard:** overview + sites list (search, filter by status/client/tag, sort by status/response/name), 24 h sparklines, site detail with response-time chart, uptime % 24 h/7 d/30 d, 30-day status bar, latest result breakdown, **Run check now** (result appears without a page reload).

## Stack

| Part | Tech |
|---|---|
| Web | Next.js 16 (App Router, standalone), Tailwind 4 + shadcn/ui, Better Auth |
| Worker | Node 24, croner, p-queue, Playwright (headless Chromium) |
| DB | MongoDB 8.0 single-node replica set `rs0` (time-series, change streams) via Mongoose 9 |
| Tooling | pnpm workspaces, TypeScript 6 (strict), Vitest + mongodb-memory-server |

```
web/              Next.js dashboard + API (auth, health, SSE)
worker/           scheduler + check runner (separate process)
packages/core     shared enums, constants, env schemas, helpers
packages/db       Mongoose models, connection, indexes
packages/emails   React Email templates (alerts, digest, test, invite)
packages/notify   Brevo + Telegram clients, preview outbox, quota guard, alert dispatcher, watchdog
docs/             GO-LIVE-CHECKLIST.md — every account/key/DNS record needed at the end
deploy/           docker-compose, Dockerfiles (web, worker), Caddyfile, Mongo init, VM/deploy/backup scripts
scripts/          dev database launcher, index sync
```

## Local development (Windows / macOS / Linux)

Requirements: **Node 24** (`.nvmrc`) and **pnpm 11**. Docker is *not* needed locally.

```bash
pnpm install
pnpm browsers:install        # downloads headless Chromium once (~115 MB) for the browser/form checks
cp .env.example .env          # then set AUTH_SECRET (see comment in the file) and APP_URL=http://localhost:3000
pnpm dev                      # starts db + web + worker together
```

Then, in a second terminal, create your admin (first time only):

```bash
pnpm create-admin --email you@mycompany.com --name "Your Name"
```

Open http://localhost:3000 and sign in. Invite teammates from **Settings → Users & invites** (copy the one-time link).

### Dev database

`pnpm dev:db` runs a real `mongod` 8.0.32 (downloaded once to `~/.cache/mongodb-binaries`) as replica set `rs0` on **127.0.0.1:27027**. It deliberately avoids 27017 so it never collides with another local MongoDB.

- Data lives in `.dev-data/mongo` (git-ignored) and **persists across restarts**.
- `pnpm dev:reset` wipes `.dev-data` (stop `pnpm dev` first).
- `pnpm db:indexes` creates collections and syncs indexes (the worker also does this on start).

### Demo data & failure simulation

```bash
pnpm seed      # 2 real public sites + 3 dev test-target sites (HTTP 500; SEO noindex + staging canonical; JS error + 404 link + failing form)
```

The web app has a **dev-only** simulation endpoint (returns 404 when `NODE_ENV=production`). Add a site with one of these URLs to watch each failure path:

| URL (`http://localhost:3000/api/dev/test-target?…`) | Simulates |
|---|---|
| `status=500` (or any code) | Down with HTTP 5xx / 4xx |
| `delay=5000` | Slow response (WARN above the site's threshold); `delay=40000` → timeout |
| `body=Hello` | Custom page text — pair with a required keyword to trigger "keyword missing" |
| `spam=1` | Defaced page ("Hacked by…", casino/pharma spam) |
| `block=cloudflare` | Cloudflare bot challenge → BLOCKED (WARN), not Down |
| `redirect=3` / `redirect=9` | Redirect chain / redirect loop (too many redirects) |
| `size=500` | Page padded to ~500 KB (page-size change) |
| `noindex=meta` / `noindex=header` | robots meta `noindex` / `X-Robots-Tag: noindex` header (SEO FAIL) |
| `canonical=https://staging.example.com/` | Canonical pointing to another domain (SEO FAIL) |
| `jserror=1` | Uncaught JavaScript error after load (browser check) |
| `blank=1` | Crashed JS app → blank page (browser check) |
| `brokenlinks=1` | A 404 link and a 404 image on the page (links check) |
| `mixed=1` | http:// script on the page (headers check — only flagged on https sites) |
| `form=ok` / `form=fail` | Contact form whose submission succeeds / fails (enable the form check + test submission, success text “Thank you for your message”) |

### Alerts without any accounts

With the default `DRY_RUN=true` (or while `BREVO_API_KEY` / `TELEGRAM_BOT_TOKEN` are empty), open **Settings → Notifications** to see channel status, the email quota and the *Send test* buttons, and **/dev/emails** · **/dev/telegram** for the exact rendered messages. See [`docs/GO-LIVE-CHECKLIST.md`](docs/GO-LIVE-CHECKLIST.md) for going live.

### Useful scripts

| Command | What |
|---|---|
| `pnpm dev` | db + web + worker |
| `pnpm dev:web` / `pnpm dev:worker` / `pnpm dev:db` | individually |
| `pnpm test` | Vitest (starts a throwaway MongoDB replica set) |
| `pnpm typecheck` / `pnpm lint` | all packages / web |
| `pnpm create-admin --email … [--name …] [--password …]` | create or promote an admin |
| `pnpm seed` | add the 5 demo sites (idempotent) |
| `pnpm browsers:install` | download headless Chromium for the browser/form checks |
| `pnpm db:backup` | back up the database now (into `BACKUP_DIR`) |
| `pnpm db:restore [name] [--yes]` | list backups / restore one (replaces the data — stop the worker first) |

### Health endpoint

`GET /api/health` → `200 {"status":"ok"}` when MongoDB is reachable **and** the worker heartbeat is < 3 min old, otherwise `503`. Point UptimeRobot / Healthchecks.io at it.

## Production

One Oracle Cloud Always Free ARM VM (2 OCPU / 12 GB) runs the whole stack with Docker Compose — step-by-step guide: **[docs/DEPLOY.md](docs/DEPLOY.md)**.

| Service | Image | Notes |
|---|---|---|
| `caddy` | caddy:2.10 | the only public service (80/443), automatic Let's Encrypt HTTPS, security headers, SSE-friendly proxy |
| `web` | `deploy/Dockerfile.web` | Next.js standalone, non-root, ~1 GB limit |
| `worker` | `deploy/Dockerfile.worker` | checks, reports, rollups, backups, headless Chromium; also the CLI tools image (`pnpm -w create-admin`, `db:restore`) |
| `mongo` | mongo:8.0 | replica set `rs0` with auth + keyfile, internal network only, least-privilege app user |

```bash
bash deploy/scripts/setup-vm.sh          # once per VM: Docker, firewall, swap, auto-updates
bash deploy/scripts/generate-secrets.sh  # values for .env
bash deploy/scripts/deploy.sh [--pull]   # build + start + wait for /api/health (also for updates)
```

Volumes: `mongo-data`, `screenshots`, `backups` (nightly, copied off-site by `deploy/scripts/backup-offsite.sh`), `caddy-data`. External monitoring: UptimeRobot on `/api/health` + Healthchecks.io heartbeat.

> Line endings: `.gitattributes` forces LF for shell scripts, compose files and the Caddyfile so they run on Linux even when edited on Windows.
