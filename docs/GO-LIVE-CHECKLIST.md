# SiteGuard — Go-live checklist

Everything you need to create or configure **once all 7 phases are done**, in the order that works best.
Nothing here is needed for local development — the app runs in **preview mode** without any accounts.

> **Last updated: Phase 7** — all sections complete. The server itself is set up with [`DEPLOY.md`](DEPLOY.md) (step by step); this list is the accounts, keys and records around it.
> Legend: ✅ ready to set up now.

---

## 0. Before you start

- [ ] Pick the dashboard subdomain, e.g. **`monitor.mycompany.com`** (used for `APP_URL` / `APP_DOMAIN`).
- [ ] Decide which email address alerts come **from** (e.g. `alerts@mycompany.com`) and who receives them (e.g. `team@mycompany.com`).
- [ ] Keep a password manager entry for every key below. Never commit `.env`.

---

## 1. ✅ Oracle Cloud Always Free VM

Step by step: [DEPLOY.md §1–§4](DEPLOY.md#1-create-the-vm).

- [ ] Oracle Cloud account (home region near your users, e.g. Mumbai/Hyderabad)
- [ ] VM `VM.Standard.A1.Flex`, **2 OCPU / 12 GB**, Ubuntu 24.04 aarch64, public IPv4 — note it: `______________`
  (You need this IP for the DNS record *and* for Brevo's authorized IPs.)
- [ ] Security List ingress: TCP 80, TCP 443 (+ UDP 443) from `0.0.0.0/0`
- [ ] `bash deploy/scripts/setup-vm.sh` ran (Docker, iptables 80/443, swap, auto-updates)
- [ ] Optional but recommended: account upgraded to Pay-As-You-Go (no charge within Always Free; avoids “out of capacity” and idle reclamation)

---

## 2. ✅ DNS record for the dashboard

At your domain registrar / DNS provider (where `mycompany.com` is managed):

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `monitor` | *VM public IPv4* | 300 |

- [ ] Record created. Check: `nslookup monitor.mycompany.com` returns the VM IP.
- If the domain is on **Cloudflare**, set this record to **DNS only (grey cloud)** — Caddy needs direct access to get the free Let's Encrypt certificate.

---

## 3. ✅ Brevo (email alerts & reports) — free plan, 300 emails/day

SiteGuard caps itself at **250/day**, keeps **10 reserved for the daily reports**, and switches to an hourly digest after 200.

1. [ ] Create a free account at **https://www.brevo.com** (sign up → confirm email → complete the company profile; Brevo may review new accounts for ~24 h).
2. [ ] **Verify the sender domain** (Brevo → *Senders, Domains & Dedicated IPs* → *Domains* → *Add a domain* → `mycompany.com`). Brevo shows the exact records to add at your DNS provider — typically:

   | Type | Name | Value (copy exactly from Brevo) | Purpose |
   |---|---|---|---|
   | TXT | `@` | `brevo-code:xxxxxxxx…` | ownership |
   | TXT | `brevo1._domainkey` (or CNAME as shown) | DKIM key from Brevo | DKIM signing |
   | TXT | `@` | `v=spf1 include:spf.brevo.com ~all` | SPF — **merge** with an existing SPF record, never create two |
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@mycompany.com` | DMARC (recommended) |

   Wait until Brevo shows the domain as **Authenticated** (can take up to 48 h, usually minutes).
3. [ ] **Add the sender**: *Senders* → *Add a sender* → name `SiteGuard`, email `alerts@mycompany.com`.
4. [ ] **Create the API key**: top-right menu → *SMTP & API* → *API Keys* → *Generate a new API key* → name `siteguard-prod`. Copy it once (starts with `xkeysib-`). → `BREVO_API_KEY`
5. [ ] **Authorize the server IP** (important!): Settings → *Security* → *Authorized IPs* → *Authorize IP address* → add the **VM public IP**.
   Brevo blocks API calls from unknown IPs (after its 30-day learning phase, or immediately if blocking is on). If you forget this, SiteGuard's *Send test email* shows: *“Brevo blocked this server's IP address … add your server's public IP”*. Brevo may also email you “Validate your IP address” — clicking that link works too.
6. [ ] Optional safety check before real sends: Brevo supports a sandbox header (`X-Sib-Sandbox: drop`) that validates requests without delivering; the in-app *Send test email* is simpler and sends one real message.

`.env`:
```env
BREVO_API_KEY=xkeysib-...
ALERT_FROM_EMAIL=alerts@mycompany.com
ALERT_FROM_NAME=SiteGuard
ALERT_TO_EMAILS=team@mycompany.com,owner@mycompany.com
EMAIL_DAILY_LIMIT=250
EMAIL_RESERVED_FOR_REPORTS=10
```

---

## 4. ✅ Telegram bot (instant alerts on your phone)

1. [ ] In Telegram, open **@BotFather** → `/newbot` → name `SiteGuard Alerts` → username e.g. `mycompany_siteguard_bot`. Copy the token (`123456789:AA…`). → `TELEGRAM_BOT_TOKEN`
2. [ ] Choose where alerts go (you can use several, comma-separated):
   - **Just you:** open your new bot and press **Start** (or send `/start`). Bots cannot message you before you do this.
   - **Team group:** create a group, add the bot as a member. (Optional: make it admin so it can post if the group restricts members.)
3. [ ] **Find the chat ID**: after sending any message to the bot / in the group, open
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and look for `"chat":{"id": …}`.
   - Personal chats: a positive number, e.g. `123456789`
   - Groups: negative, supergroups start with `-100…`
   → `TELEGRAM_CHAT_ID` (comma-separate multiple, e.g. `123456789,-1001234567890`)
4. [ ] Keep the token secret (anyone with it can post as your bot). If leaked: @BotFather → `/revoke`.

`.env`:
```env
TELEGRAM_BOT_TOKEN=123456789:AA...
TELEGRAM_CHAT_ID=123456789,-1001234567890
```

---

## 5. ✅ Switch alerts from preview to live

1. [ ] Set in `.env`: `DRY_RUN=false`
2. [ ] Restart web + worker (Phase 7: `docker compose up -d`).
3. [ ] Dashboard → **Settings → Notifications**: both channels show **Live**.
4. [ ] Click **Send test email** and **Send test Telegram** — both must arrive. Any failure shows the exact reason and a fix hint (wrong key, IP not authorized, sender not verified, chat not found, bot blocked…).
5. [ ] Keep the preview pages (`/dev/emails`, `/dev/telegram`) in mind for later debugging — they show exactly what would be sent whenever `DRY_RUN=true`.

---

## 6. ✅ Google PageSpeed Insights API key (performance & Lighthouse SEO scores)

Free: **25,000 queries/day**, 400 per 100 s. SiteGuard uses 2 queries per site per run (mobile + desktop), every 12 h by default → 50 sites ≈ 200/day.

**Without a key** SiteGuard still works, but Google's keyless quota is shared and is often **zero** (a keyless test on 24 Sep 2026 got HTTP 429 “Queries per day … limit 0”). Runs are then shown as **“Skipped – rate limited”**, retried after ~30 min, and are **never** counted as failures or alerts. So in practice you need the key to get real scores.

1. [ ] Open **https://console.cloud.google.com/** and sign in with the company Google account.
2. [ ] Top bar → project picker → **New project** → name `siteguard` → *Create* (no billing account needed).
3. [ ] With that project selected: **APIs & Services → Library** → search **“PageSpeed Insights API”** → **Enable**.
4. [ ] **APIs & Services → Credentials → + Create credentials → API key**. Copy it (starts with `AIza…`). → `PSI_API_KEY`
5. [ ] Click the new key → **Edit API key** (recommended hardening):
   - *API restrictions* → **Restrict key** → tick only **PageSpeed Insights API** → Save.
   - *Application restrictions* → **IP addresses** → add the **VM public IP** (once the VM exists; leave “None” while testing locally, or add your office IP too).
6. [ ] Put it in `.env` and restart the worker. It is picked up automatically — no other change:
   ```env
   PSI_API_KEY=AIza...
   ```
7. [ ] Check: open any site → **Performance** tab → the “Running without a PageSpeed API key” banner disappears after the next run; click **Run pagespeed check** (30–90 s) → scores and charts appear.
   - With a key the worker runs 2 sites in parallel (1 without) and spaces calls ~1 s apart (20 s without).
   - `PSI_API_KEY rejected by Google` in the result = typo in the key, API not enabled, or the IP restriction doesn't include the server IP.
   - Optional manual key test in a browser: `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://example.com&key=AIza...` → JSON containing `lighthouseResult`.

> Nothing else in Phase 4 needs an account: SSL, domain expiry (RDAP, WHOIS fallback), DNS (system resolver with DNS-over-HTTPS fallback) and on-page SEO only use public protocols.
>
> **Firewall note:** the VM must allow outbound TCP 443 (PSI, RDAP, DNS-over-HTTPS) and TCP 43 (WHOIS fallback for the few TLDs without RDAP).

---

## 6b. ✅ Browser, form, links and security-header checks (Phase 5)

No accounts or keys needed. Before go-live:

1. [ ] **Chromium on the server** — the worker image must include headless Chromium and its system libraries (Phase 7 Dockerfile runs `npx playwright install --with-deps chromium`; works on the ARM VM). Locally: `pnpm browsers:install`.
2. [ ] **Screenshots volume** — `SCREENSHOT_DIR=/data/screenshots`, mounted into **both** the worker (writes) and the web container (serves them). Size: ~100 KB × 7 per site (≈ 35 MB for 50 sites).
3. [ ] **Client consent for form test submissions** — “Test submission” sends a real `[SITEGUARD-TEST]` message every day through the client's contact form. Turn it on per site **only after the client agreed**; otherwise leave it off (the form is still render-checked daily). Tell the client the test email address `siteguard-test@example.com` so they can filter it.
4. [ ] **Whitelisting** — sites behind Cloudflare/Wordfence may show a bot challenge to the headless browser. Allow the SiteGuard server IP (same rule as the uptime check). The browser's User-Agent is a normal Chrome UA ending in `SiteGuard-Monitor/1.0`.
5. [ ] **Outbound traffic** — the weekly link crawl makes up to ~400 requests per site (5 at a time); no inbound ports needed.

---

## 7. ✅ External uptime monitor for SiteGuard itself

Who watches the watcher? Two free, independent checks ([DEPLOY.md §10](DEPLOY.md#10-watch-the-watcher)):
- [ ] **UptimeRobot** (free): *HTTP(s) – Keyword* monitor on `https://monitor.mycompany.com/api/health`, keyword `"status":"ok"`, every 5 min (200 = DB + worker OK, 503 = problem). Alert contact: your phone/email — *not* the SiteGuard Telegram bot (it may be what's down).
- [ ] **Healthchecks.io** (free): check with period 5 min, grace 10 min → ping URL → `HEARTBEAT_PING_URL` in `.env` → `deploy.sh`. The worker pings every 5 min.
- Also built in: if the worker's heartbeat is 15+ min old, the **web app itself** sends a critical “Monitoring worker is offline” alert (Telegram + email + in-app).

---

## 8. ✅ Backups, reports & data retention (Phase 6)

No accounts needed. Before go-live:

1. [ ] **Backup volume** — `BACKUP_DIR=/data/backups` mounted into the worker (and the web container, so Settings → System can list them / “Back up now”). `BACKUP_KEEP_DAYS=7`.
2. [ ] **Off-site copy** — backups sit on the same VM as the database; a lost VM loses both. `deploy/scripts/backup-offsite.sh` copies them nightly with rclone to e.g. Google Drive (15 GB free) or Oracle Object Storage (20 GB free): configure an rclone remote, set `OFFSITE_REMOTE`, add the cron line — [DEPLOY.md §11](DEPLOY.md#11-off-site-backups).
3. [ ] **Restore drill once** (10 min, do it before you need it): on a test machine / local dev, copy one backup folder, then `pnpm db:restore <folder> --yes` and open the dashboard. The automated test suite also verifies backup → wipe → restore on every run.
4. [ ] **Report times** — Settings → Alerts, reports & thresholds (defaults 09:00 and 21:00 IST). Reports use the 10 emails/day reserved in the Brevo quota. Check the first real one arrives (Reports → “Send morning report now”).
5. [ ] **Sender reputation** — reports go to the same `ALERT_TO_EMAILS`; ask recipients to mark the first one “Not spam”.

Retention (automatic): raw check results 30 days · hourly uptime 1 year · reports 1 year · in-app notifications 90 days · email log 30 days · screenshots last 7 per site · backups `BACKUP_KEEP_DAYS`.

---

## 8b. ✅ HTTPS, production MongoDB

- [ ] `APP_DOMAIN`, `ACME_EMAIL` in `.env` — Caddy gets and renews the Let's Encrypt certificate automatically (needs §2 DNS + §1 ports).
- [ ] `bash deploy/scripts/generate-secrets.sh` → strong `MONGO_ROOT_PASSWORD`, `MONGO_APP_PASSWORD` and the matching production `MONGODB_URI` (`…@mongo:27017/siteguard?replicaSet=rs0&authSource=siteguard`). Set them **before the first start** — they're applied only to an empty database.
- MongoDB is never published to the internet (internal Docker network only); only Caddy listens on 80/443.

---

## 9. ✅ App secrets & first admin

- [ ] `AUTH_SECRET` — a fresh one for production (never reuse the dev value), from `bash deploy/scripts/generate-secrets.sh`.
- [ ] `APP_URL=https://monitor.mycompany.com` (must be exact — used for login cookies and every link in emails/Telegram).
- [ ] `TIMEZONE=Asia/Kolkata`, `LOG_LEVEL=info`
- [ ] After the first start, create the admin (the worker image carries the CLI tools):
  ```bash
  cd /opt/siteguard/deploy
  docker compose --env-file ../.env exec worker pnpm -w create-admin --email you@mycompany.com --name "Your Name"
  ```

---

## 10. ✅ Launch day

- [ ] `bash deploy/scripts/deploy.sh` finishes with “SiteGuard is up”
- [ ] https://monitor.mycompany.com shows a valid padlock; `/api/health` → `"status":"ok"`
- [ ] Admin created, teammates invited
- [ ] Sites added (or CSV imported); first results within a minute
- [ ] `DRY_RUN=false`, Settings → Notifications: email + Telegram **Live**, both test messages received
- [ ] PageSpeed key set — Performance tab shows scores, no “without API key” banner
- [ ] UptimeRobot + Healthchecks.io set up; pause the worker once (`docker compose stop worker`) and confirm both alert you, then start it again
- [ ] Reports → “Send morning report now” arrives by email + Telegram
- [ ] Settings → System → “Back up now” works; off-site copy ran once; restore drill done (§8)
- [ ] Clients with form test submissions have agreed (§6b)

---

## Complete `.env` reference (production)

| Variable | Needed from | Example / note |
|---|---|---|
| `APP_URL` | Phase 1 | `https://monitor.mycompany.com` |
| `AUTH_SECRET` | Phase 1 | 32+ random chars, unique to prod |
| `TIMEZONE` | Phase 1 | `Asia/Kolkata` |
| `LOG_LEVEL` | Phase 1 | `info` |
| `MONGODB_URI` | Phase 1 | `mongodb://siteguard:<pw>@mongo:27017/siteguard?replicaSet=rs0&authSource=siteguard` |
| `MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD` | Phase 1 | strong, unique |
| `MONGO_APP_DB` / `MONGO_APP_USER` / `MONGO_APP_PASSWORD` | Phase 1 | `siteguard` / `siteguard` / strong |
| `DRY_RUN` | Phase 3 | `false` once Brevo + Telegram are set |
| `BREVO_API_KEY` | Phase 3 | `xkeysib-…` |
| `ALERT_FROM_EMAIL` / `ALERT_FROM_NAME` | Phase 3 | `alerts@mycompany.com` / `SiteGuard` |
| `ALERT_TO_EMAILS` | Phase 3 | comma-separated |
| `EMAIL_DAILY_LIMIT` / `EMAIL_RESERVED_FOR_REPORTS` | Phase 3 | `250` / `10` |
| `TELEGRAM_BOT_TOKEN` | Phase 3 | from @BotFather |
| `TELEGRAM_CHAT_ID` | Phase 3 | comma-separated chat IDs |
| `PSI_API_KEY` | Phase 4 | Google Cloud API key (`AIza…`), restricted to PageSpeed Insights API — see §6 |
| `BACKUP_DIR` / `BACKUP_KEEP_DAYS` | Phase 6 | `/data/backups` (volume in worker + web) / `7` |
| `HEARTBEAT_PING_URL` | Phase 7 | Healthchecks.io ping URL (§7) |
| `OFFSITE_REMOTE` | Phase 7 | rclone remote:folder for off-site backups, e.g. `gdrive:siteguard-backups` (§8) |
| `SCREENSHOT_DIR` | Phase 5 | `/data/screenshots` — Docker volume shared by worker (writes) and web (serves); relative paths are from the repo root |
| `APP_DOMAIN` / `ACME_EMAIL` | Phase 7 | Caddy HTTPS |
