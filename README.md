# SiteGuard

Internal monitoring for client websites — uptime, speed, SEO, SSL, domain, forms and more — with alerts by email (Brevo), Telegram and in-app, plus daily morning/night reports. 100% free stack, self-hosted on one Oracle Cloud Always Free ARM VM.

> Status: **Phase 1** (foundation). The full deployment guide (Oracle VM, Docker, Caddy, Brevo, Telegram, PageSpeed key, backups) lands in Phase 7.

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

### Useful scripts

| Command | What |
|---|---|
| `pnpm dev` | db + web + worker |
| `pnpm dev:web` / `pnpm dev:worker` / `pnpm dev:db` | individually |
| `pnpm test` | Vitest (starts a throwaway MongoDB replica set) |
| `pnpm typecheck` / `pnpm lint` | all packages / web |
| `pnpm create-admin --email … [--name …] [--password …]` | create or promote an admin |

### Health endpoint

`GET /api/health` → `200 {"status":"ok"}` when MongoDB is reachable **and** the worker heartbeat is < 3 min old, otherwise `503`. Point UptimeRobot / Healthchecks.io at it.

## Production (preview)

`deploy/docker-compose.yml` currently runs MongoDB with auth + keyfile as replica set `rs0` on the internal Docker network only (no published port), WiredTiger cache 1 GB. On first boot it creates the root user and a least-privilege app user (`deploy/mongo/init-app-user.sh`), and the healthcheck initiates the replica set.

```bash
cd deploy && docker compose --env-file ../.env up -d mongo
```

> Line endings: `.gitattributes` forces LF for shell scripts, compose files and the Caddyfile so they run on Linux even when edited on Windows.
