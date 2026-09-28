#!/usr/bin/env bash
# One-time setup of a fresh Oracle Cloud "Always Free" Ubuntu 24.04 (aarch64) VM.
#
#   curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/main/deploy/scripts/setup-vm.sh | bash
#   (or copy it over and run: bash setup-vm.sh)
#
# Installs Docker, opens ports 80/443 in the VM firewall (Oracle images block
# everything except SSH by default), adds swap, sets the timezone and enables
# automatic security updates. Safe to run again.
set -euo pipefail

TIMEZONE="${TIMEZONE:-Asia/Kolkata}"
SWAP_GB="${SWAP_GB:-4}"

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

log "System update"
$SUDO apt-get update -y
$SUDO DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
$SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git gnupg unattended-upgrades iptables-persistent

log "Timezone → $TIMEZONE"
$SUDO timedatectl set-timezone "$TIMEZONE"

log "Docker Engine + Compose plugin (official apt repository)"
if ! command -v docker >/dev/null 2>&1; then
  $SUDO install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
    $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
  $SUDO apt-get update -y
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
$SUDO systemctl enable --now docker
if [ -n "${SUDO}" ] && ! id -nG "$USER" | grep -qw docker; then
  $SUDO usermod -aG docker "$USER"
  echo "Added $USER to the docker group — log out and back in (or run: newgrp docker)."
fi

log "Firewall: allow HTTP/HTTPS (the Oracle Security List must allow them too — see docs/DEPLOY.md)"
for rule in "-p tcp --dport 80" "-p tcp --dport 443" "-p udp --dport 443"; do
  # shellcheck disable=SC2086
  if ! $SUDO iptables -C INPUT $rule -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null; then
    # shellcheck disable=SC2086
    $SUDO iptables -I INPUT 1 $rule -m conntrack --ctstate NEW -j ACCEPT
  fi
done
$SUDO netfilter-persistent save

log "Swap (${SWAP_GB} GB) — keeps image builds from running out of memory"
if ! swapon --show | grep -q /swapfile; then
  $SUDO fallocate -l "${SWAP_GB}G" /swapfile
  $SUDO chmod 600 /swapfile
  $SUDO mkswap /swapfile
  $SUDO swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
fi

log "Automatic security updates"
$SUDO dpkg-reconfigure -f noninteractive unattended-upgrades

log "Docker log rotation defaults"
if [ ! -f /etc/docker/daemon.json ]; then
  echo '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }' | $SUDO tee /etc/docker/daemon.json >/dev/null
  $SUDO systemctl restart docker
fi

log "Done. Next: clone the repo, create .env, run deploy/scripts/deploy.sh (docs/DEPLOY.md, step 5)."
docker --version || true
