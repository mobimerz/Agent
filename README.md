# SiteGuard

Internal monitoring for client websites — uptime, speed, SEO, SSL, domain, forms and more — with alerts by email (Brevo), Telegram and in-app, plus daily morning/night reports. 100% free stack, self-hosted on one Oracle Cloud Always Free ARM VM.

> Status: **Phase 2** (sites + uptime/content monitoring). The full deployment guide (Oracle VM, Docker, Caddy, Brevo, Telegram, PageSpeed key, backups) lands in Phase 7.

## What works today

- **Sites:** add / edit / pause / delete, per-site check toggles + intervals, slow threshold, important pages, required keyword. Bulk **CSV import** with a preview (valid / invalid with reason / duplicates) and a downloadable template.
- **Uptime / HTTP check** (every 5 min): real `GET` (never `HEAD`), up to 5 redirects with the full chain + final URL, 30 s timeout, TTFB. Exact failure reason: DNS failure, connection refused, timeout, SSL/TLS error, connection reset, HTTP 4xx, HTTP 5xx, too many redirects, slow (WARN), important page failing (WARN).
- **Bot protection ≠ downtime:** Cloudflare / Sucuri / Imperva / Wordfence / ModSecurity / Vercel challenges and 429s are reported as **BLOCKED (WARN)** with a whitelist hint, never as DOWN.
- **Content / defacement check** (every 30 min): required keyword, hack/spam words (visible text only), drastic page-size change vs a moving baseline. If the page is unreachable it reports UNKNOWN (the uptime check owns availability — no double alerts).
- **False-alarm protection:** a FAIL is re-checked twice, 60 s apart; the site is only marked **Down** after 3 consecutive failures. (`consecutiveFails` / `retryAttempt` live in `jobsState`; Phase 3 plugs the incident engine into `worker/src/incidents/hook.ts`.)
- **Scheduler:** croner tick every 3 s → atomic job claim in MongoDB → p-queue (HTTP ×10). Restart-safe, no duplicate runs.
- **Dashboard:** overview + sites list (search, filter by status/client/tag, sort by status/response/name), 24 h sparklines, site detail with response-time chart, uptime % 24 h/7 d/30 d, 30-day status bar, latest result breakdown, **Run check now** (result appears without a page reload).

## Stack

| Part | Tech |
|---|---|
| Web | Next.js 16 (App Router, standalone), Tailwind 4 + shadcn/ui, Better Auth |
| Worker | Node 24, croner, p-queue, Playwright (Phase 5) |
| DB | MongoDB 8.0 single-node replica set `rs0` (time-series, change streams) via Mongoose 9 |
| Tooling | pnpm workspaces, TypeScript 6 (strict), Vitest + mongodb-memory-server |

```
web/              Next.js dashboard + API (auth, health, SSE)
worker/           scheduler + check runner (separate process)
packages/core     shared enums, constants, env schemas, helpers
packages/db       Mongoose models, connection, indexes
deploy/           docker-compose, Mongo init scripts (Caddy/backup later)
scripts/          dev database launcher, index sync
```

## Local development (Windows / macOS / Linux)

Requirements: **Node 24** (`.nvmrc`) and **pnpm 11**. Docker is *not* needed locally.

```bash
pnpm install
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
pnpm seed      # 2 real public sites + 1 site pointing at the dev test target (HTTP 500)
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

### Useful scripts

| Command | What |
|---|---|
| `pnpm dev` | db + web + worker |
| `pnpm dev:web` / `pnpm dev:worker` / `pnpm dev:db` | individually |
| `pnpm test` | Vitest (starts a throwaway MongoDB replica set) |
| `pnpm typecheck` / `pnpm lint` | all packages / web |
| `pnpm create-admin --email … [--name …] [--password …]` | create or promote an admin |
| `pnpm seed` | add the 3 demo sites (idempotent) |

### Health endpoint

`GET /api/health` → `200 {"status":"ok"}` when MongoDB is reachable **and** the worker heartbeat is < 3 min old, otherwise `503`. Point UptimeRobot / Healthchecks.io at it.

## Production (preview)

`deploy/docker-compose.yml` currently runs MongoDB with auth + keyfile as replica set `rs0` on the internal Docker network only (no published port), WiredTiger cache 1 GB. On first boot it creates the root user and a least-privilege app user (`deploy/mongo/init-app-user.sh`), and the healthcheck initiates the replica set.

```bash
cd deploy && docker compose --env-file ../.env up -d mongo
```

> Line endings: `.gitattributes` forces LF for shell scripts, compose files and the Caddyfile so they run on Linux even when edited on Windows.
