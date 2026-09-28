#!/usr/bin/env bash
# Build and (re)start SiteGuard. Use for the first deploy and for every update.
#
#   bash deploy/scripts/deploy.sh            # build + start what's checked out
#   bash deploy/scripts/deploy.sh --pull     # git pull first (updates)
#
# Refuses to start with placeholder secrets, waits until /api/health is OK.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/.env"
COMPOSE=(docker compose -f "$ROOT/deploy/docker-compose.yml" --env-file "$ENV_FILE")
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die ".env not found at $ENV_FILE — copy .env.example and fill it in (docs/DEPLOY.md, step 4)."

get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
for v in APP_URL APP_DOMAIN ACME_EMAIL AUTH_SECRET MONGODB_URI MONGO_ROOT_PASSWORD MONGO_APP_PASSWORD; do
  [ -n "$(get "$v")" ] || die "$v is empty in .env"
done
for v in AUTH_SECRET MONGO_ROOT_PASSWORD MONGO_APP_PASSWORD; do
  case "$(get "$v")" in change-me*) die "$v still has the placeholder value — generate one with: bash deploy/scripts/generate-secrets.sh" ;; esac
done
[ "$(get AUTH_SECRET | tr -d '\r\n' | wc -c)" -ge 32 ] || die "AUTH_SECRET must be at least 32 characters"
case "$(get APP_URL)" in https://*) ;; *) die "APP_URL must start with https:// in production" ;; esac
case "$(get MONGODB_URI)" in *@mongo:27017/*replicaSet=rs0*) ;; *) die "MONGODB_URI must point at the compose service: mongodb://USER:PASS@mongo:27017/siteguard?replicaSet=rs0&authSource=siteguard" ;; esac

if [ "${1:-}" = "--pull" ]; then
  log "git pull"
  git -C "$ROOT" pull --ff-only
fi

log "Building images (first build on the ARM VM takes ~10 min)"
"${COMPOSE[@]}" build --pull

log "Starting services"
"${COMPOSE[@]}" up -d --remove-orphans

log "Waiting for https://$(get APP_DOMAIN)/api/health"
ok=""
for _ in $(seq 1 60); do
  if curl -fsS --max-time 5 "https://$(get APP_DOMAIN)/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 5
done
"${COMPOSE[@]}" ps
if [ -n "$ok" ]; then
  log "SiteGuard is up: $(get APP_URL)"
else
  echo "Health check did not pass within 5 min. Look at: ${COMPOSE[*]} logs --tail=100 web worker caddy" >&2
  echo "(The first HTTPS certificate needs DNS pointing here and ports 80/443 open.)" >&2
  exit 1
fi

log "Removing old images"
docker image prune -f >/dev/null
