# SiteGuard — production deployment (Oracle Cloud Always Free)

One small ARM VM runs everything: MongoDB, the web app, the worker (checks, reports, backups, headless Chromium) and Caddy (HTTPS). Cost: **₹0** on Oracle's Always Free tier.

```
Internet ──443/80──▶ caddy ──▶ web:3000 ─┐
                                          ├──▶ mongo:27017 (internal only)
                     worker (checks, Chromium, reports, backups) ─┘
volumes: mongo-data · screenshots · backups · caddy-data
```

Time needed: ~1 hour (most of it waiting for the first build and DNS).
Every account/key is also listed in [`GO-LIVE-CHECKLIST.md`](GO-LIVE-CHECKLIST.md).

---

## 1. Create the VM

1. Sign up at **https://signup.cloud.oracle.com** (card needed for verification; Always Free resources are never charged). Pick a **home region** close to your users (e.g. *India West (Mumbai)* or *India South (Hyderabad)*) — it can't be changed later.
2. Console → **Compute → Instances → Create instance**:
   - **Name:** `siteguard`
   - **Image:** Canonical **Ubuntu 24.04** (the non-Minimal one, *aarch64*)
   - **Shape:** *Change shape* → **Ampere** → `VM.Standard.A1.Flex` → **2 OCPU, 12 GB RAM** (inside the free 4 OCPU / 24 GB allowance)
   - **Networking:** create a new VCN + public subnet, **Assign a public IPv4 address: yes**
   - **SSH keys:** *Generate a key pair* → **download the private key** (or paste your own public key)
   - **Boot volume:** 50 GB is plenty (200 GB free in total)
3. *Create*. If you get **“Out of capacity”**, try another *Availability domain* in the same screen, or retry later (common for free ARM). Upgrading the account to *Pay As You Go* removes this and still costs nothing as long as you stay within Always Free limits — it also stops Oracle from reclaiming the VM for being idle.
4. Note the **Public IP address** from the instance page.

## 2. Open ports 80 and 443 in Oracle's firewall

Oracle blocks everything except SSH at the network level:

Instance page → **Primary VNIC → Subnet → Security List (Default)** → **Add Ingress Rules**:

| Source CIDR | IP Protocol | Destination port | Why |
|---|---|---|---|
| `0.0.0.0/0` | TCP | `80` | Let's Encrypt HTTP challenge + redirect to HTTPS |
| `0.0.0.0/0` | TCP | `443` | Dashboard |
| `0.0.0.0/0` | UDP | `443` | HTTP/3 (optional) |

(The VM's own `iptables` is opened by the setup script in step 4.)

## 3. DNS record for the dashboard

At the DNS provider of your company domain:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `monitor` | *VM public IP* | 300 |

On **Cloudflare**, set it to **DNS only (grey cloud)** — Caddy must reach Let's Encrypt directly.
Check from your PC: `nslookup monitor.mycompany.com` → the VM IP.

## 4. Prepare the server

```bash
ssh -i ~/Downloads/ssh-key-siteguard.key ubuntu@<VM_IP>
```

Then on the VM:

```bash
sudo mkdir -p /opt/siteguard && sudo chown ubuntu:ubuntu /opt/siteguard
git clone https://github.com/mobimerz/Agent.git /opt/siteguard
bash /opt/siteguard/deploy/scripts/setup-vm.sh
exit        # log out and back in so the docker group applies
```

The repo is private? Use a GitHub **fine-grained personal access token** (read-only, this repo) as the password when cloning, or add a read-only **deploy key**.

`setup-vm.sh` installs Docker + Compose, opens 80/443 in `iptables`, adds 4 GB swap, sets the timezone to Asia/Kolkata, enables automatic security updates and Docker log rotation. It is safe to re-run.

## 5. Configure `.env`

```bash
cd /opt/siteguard
cp .env.example .env
bash deploy/scripts/generate-secrets.sh     # prints AUTH_SECRET, Mongo passwords and the matching MONGODB_URI
nano .env
```

Set at least:

| Variable | Value |
|---|---|
| `APP_URL` | `https://monitor.mycompany.com` |
| `APP_DOMAIN` | `monitor.mycompany.com` |
| `ACME_EMAIL` | your email (Let's Encrypt expiry notices) |
| `AUTH_SECRET`, `MONGO_ROOT_PASSWORD`, `MONGO_APP_PASSWORD`, `MONGODB_URI` | from `generate-secrets.sh` (the URI must use the **same** app password) |
| `LOG_LEVEL` | `info` |
| `DRY_RUN` | keep `true` for the first start; switch to `false` after step 9 |

`SCREENSHOT_DIR` / `BACKUP_DIR` are set by docker-compose (volumes) — leave the defaults. Keys for Brevo, Telegram and PageSpeed: see the checklist; they can be added later.

> ⚠ The Mongo passwords are applied **only on the first start** (empty database). Changing them later needs a manual `db.changeUserPassword` — pick them once.

## 6. Build and start

```bash
bash deploy/scripts/deploy.sh
```

The script refuses placeholder secrets, builds both images (first build on the ARM VM ≈ 10 min — Chromium included), starts everything and waits until `https://monitor.mycompany.com/api/health` answers. Caddy obtains the HTTPS certificate on the first request.

Check: `docker compose -f deploy/docker-compose.yml ps` → `mongo` *healthy*, `web` *healthy*, `worker`, `caddy` *running*.

## 7. First admin

```bash
cd /opt/siteguard/deploy
docker compose --env-file ../.env exec worker pnpm -w create-admin --email you@mycompany.com --name "Your Name"
```

It prints a generated password once. Open **https://monitor.mycompany.com**, sign in, change nothing else yet.
Invite teammates from **Settings → Users & invites**.

## 8. Add sites

**Sites → Add site**, or **Sites → Import CSV** for many at once. First results appear within a minute.

## 9. Turn on real alerts

Follow [GO-LIVE-CHECKLIST.md](GO-LIVE-CHECKLIST.md) §3–§6 (Brevo, Telegram, PageSpeed key), then in `.env` set `DRY_RUN=false` and run `bash deploy/scripts/deploy.sh` again. **Settings → Notifications** → both channels *Live* → *Send test email* / *Send test Telegram*.

## 10. Watch the watcher

- **UptimeRobot** (free, 5-min checks): *New monitor → HTTP(s) – Keyword* → URL `https://monitor.mycompany.com/api/health`, keyword `"status":"ok"`. Alerts you if the VM, Caddy, the web app, MongoDB **or** the worker is down (the endpoint returns 503 when the worker's heartbeat is older than 3 min).
- **Healthchecks.io** (free): create a check with period **5 min**, grace **10 min** → copy the ping URL into `.env` as `HEARTBEAT_PING_URL` → `deploy.sh`. The worker pings it every 5 minutes; if pings stop you get an email.
- Built in: the web app itself sends a critical alert when the worker is silent for 15 minutes.

## 11. Off-site backups

Backups are written nightly at 02:30 into the `backups` volume (kept `BACKUP_KEEP_DAYS`). Copy them off the VM:

```bash
docker run --rm -it -v ~/.config/rclone:/config/rclone rclone/rclone:1 config
# → "n" new remote, name it e.g. gdrive, type "drive" (Google Drive) or "oracleobjectstorage", follow the prompts
echo 'OFFSITE_REMOTE=gdrive:siteguard-backups' >> /opt/siteguard/.env
bash /opt/siteguard/deploy/scripts/backup-offsite.sh          # test once
( crontab -l 2>/dev/null; echo '30 3 * * * /opt/siteguard/deploy/scripts/backup-offsite.sh >> /home/ubuntu/siteguard-offsite.log 2>&1' ) | crontab -
```

Off-site copies are kept 30 days (`OFFSITE_KEEP_DAYS`).

---

## Day-to-day operations

| Task | Command (in `/opt/siteguard/deploy`, prefix `docker compose --env-file ../.env`) |
|---|---|
| Update to the latest code | `bash ../deploy/scripts/deploy.sh --pull` |
| Status | `… ps` |
| Logs (follow) | `… logs -f --tail=100 worker` (or `web`, `caddy`, `mongo`) |
| Restart one service | `… restart worker` |
| Stop / start everything | `… down` / `… up -d` (data stays in volumes) |
| Back up now | Dashboard → **Settings → System → Back up now**, or `… exec worker pnpm -w db:backup` |
| List backups | `… exec worker pnpm -w db:restore` |
| Restore a backup | `… stop worker` → `… run --rm worker pnpm -w db:restore siteguard-YYYY-MM-DD_HHMM --yes` → `… start worker` |
| Restore from off-site | `docker run --rm -v siteguard_backups:/backups -v ~/.config/rclone:/config/rclone rclone/rclone:1 copy gdrive:siteguard-backups/siteguard-… /backups/siteguard-…` then restore as above |
| Mongo shell | `… exec mongo mongosh -u root -p --authenticationDatabase admin` (root password from .env) |
| Disk usage | `docker system df -v` |

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Browser shows a certificate error or `deploy.sh` waits forever | DNS not pointing at the VM yet, Cloudflare proxy (orange cloud) on, or port 80/443 closed (Oracle Security List **and** `iptables`). `… logs caddy` shows the exact ACME error. |
| `/api/health` → `"worker":"down"` | `… logs --tail=200 worker`. Usually a bad `.env` value (the worker exits with “Invalid environment variables: …”). |
| `mongo` never becomes healthy | Wrong `MONGO_ROOT_*` after the first start (they're only used on an empty volume), or the VM is out of memory (`free -h`). |
| Worker restarts, logs mention Chromium / “Target closed” | Out of memory during a browser check — check `docker stats`; the limit is 3 GB, lower `linksMaxPages` or add swap. |
| Emails fail with “IP not authorized” | Add the VM public IP in Brevo → Security → Authorized IPs. |
| Out of disk | `docker system prune` (unused images), check `docker system df -v`; raw results expire after 30 days automatically. |
| Oracle stopped the VM (“idle”) | Always Free VMs using < 20 % CPU for 7 days may be reclaimed; convert the account to Pay-As-You-Go (still free within limits). |
