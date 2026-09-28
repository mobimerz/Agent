# SiteGuard — working rules for Claude

## Communication (permanent rule)

- **All end-of-phase summaries and explanations for the user must be in Hinglish (Roman Hindi mixed with English), with exact steps to test it myself.**
  Test steps = exact commands to run, exact URLs to open, exact buttons to click, and what the user should see. Include how to simulate failures locally (dev test-target URLs, fixtures) where possible.
- Code, comments, commit messages, docs (README, GO-LIVE-CHECKLIST) stay in English.

## Project shape

- pnpm monorepo: `web/` (Next.js 16 — read `web/AGENTS.md`, APIs differ from older Next), `worker/` (scheduler + checks), `packages/core` (enums, constants, env, pure helpers — no I/O), `packages/db` (Mongoose models), `packages/notify`, `packages/emails`.
- Built in phases (1–7). `ACTIVE_CHECK_TYPES` / `CHECK_PHASE` in `packages/core/src/constants.ts` gate what is live.
- Dev runs on Windows: `pnpm dev` (own mongod on 127.0.0.1:27027). Docker is only for production.

## Conventions to keep

- **Every check** is a `CheckModule` in `worker/src/checks/` and returns `CheckOutcome` (status + reason + metrics + message). Register it in `checks/index.ts` and in `ACTIVE_CHECK_TYPES`.
  - `UNKNOWN` = could not decide → never alerts, never breaks/extends streaks.
  - `skipped: true` (e.g. PSI rate limited) → stored in history, but does not touch `site.current` or incidents.
  - FAIL triggers 60 s confirmation re-checks; checks that are slow/quota-bound (PageSpeed) must use WARN, not FAIL.
  - Store trimmed metrics only — never raw Lighthouse / RDAP JSON.
  - Each new reason gets a label + a "how to fix" hint in `packages/core/src/reasons.ts`.
  - Checks with side effects (form test submission) set `confirmRetries` → 0 so a FAIL is never re-run every 60 s.
  - Browser checks use `withBrowserContext()` (`worker/src/lib/browser.ts`, one shared Chromium, queue concurrency 1). Chromium: `pnpm browsers:install`; browser tests skip with a note when it is missing.
  - Crawlers never GET admin/logout/cart/add-to-cart URLs.
- **Incident rules** live in `worker/src/incidents/engine.ts` (`classify`). New check types need an explicit classification there.
- **Tests**: Vitest; DB tests use a throwaway replica set (`packages/db/test/setup-mongo.ts`). **No live network calls in tests** — use local servers, msw, or saved fixtures (`worker/test/fixtures/`).
- **Missing API keys never crash anything**: channels/services degrade (preview mode, keyless PSI) and the UI says so.
- `docs/GO-LIVE-CHECKLIST.md` is updated every phase with every account/key/DNS step the feature needs.
- README "What works today" is updated every phase.
- HTTP checks use GET (never HEAD) with the SiteGuard User-Agent; bot-protection responses are BLOCKED (WARN), never DOWN.
- **Production** = `deploy/` (docker-compose, `Dockerfile.web` standalone, `Dockerfile.worker` = worker + CLI tools, Caddyfile, scripts) + `docs/DEPLOY.md`. New env vars go into `.env.example`, the GO-LIVE-CHECKLIST table and (if they're paths) compose `environment:`. Docker isn't installed on the dev machine: verify with `pnpm --filter @siteguard/web build` + running `web/.next/standalone/web/server.js` with `NODE_ENV=production`.
- Web typecheck runs `next typegen` first (route types for `RouteContext<…>`); a stale `web/tsconfig.tsbuildinfo` can cause bogus Mongoose type errors — delete it.
- Before finishing a phase: `pnpm typecheck`, `pnpm lint`, `pnpm test` must all pass. Commit only when the user asks (one commit per phase, message style like `git log`).
