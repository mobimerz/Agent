#!/usr/bin/env bash
# Copy the nightly backups (docker volume "siteguard_backups") off this server
# with rclone — Google Drive, Oracle Object Storage, S3, Dropbox… anything
# `rclone config` supports. Run from cron after the 02:30 backup:
#
#   30 3 * * * /opt/siteguard/deploy/scripts/backup-offsite.sh >> /var/log/siteguard-offsite.log 2>&1
#
# One-time: docker run --rm -it -v ~/.config/rclone:/config/rclone rclone/rclone config
#           (create a remote, e.g. "gdrive"), then set OFFSITE_REMOTE=gdrive:siteguard-backups in .env
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REMOTE="${OFFSITE_REMOTE:-$(grep -E '^OFFSITE_REMOTE=' "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2-)}"
KEEP_DAYS="${OFFSITE_KEEP_DAYS:-30}"
[ -n "$REMOTE" ] || { echo "OFFSITE_REMOTE is not set (.env) — nothing to do"; exit 0; }

echo "$(date -Is) copying backups → $REMOTE"
docker run --rm \
  -v siteguard_backups:/backups:ro \
  -v "$HOME/.config/rclone:/config/rclone:ro" \
  rclone/rclone:1 copy /backups "$REMOTE" --transfers 2 --checksum
# Keep the off-site copy longer than the on-server one, but not forever.
docker run --rm -v "$HOME/.config/rclone:/config/rclone:ro" rclone/rclone:1 \
  delete "$REMOTE" --min-age "${KEEP_DAYS}d" --rmdirs
echo "$(date -Is) done"
