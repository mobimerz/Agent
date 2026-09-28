#!/usr/bin/env bash
# Print fresh random secrets for .env (copy them in; never commit .env).
set -euo pipefail
rand() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-"$1"; }
APP_PW="$(rand 32)"
echo "AUTH_SECRET=$(rand 48)"
echo "MONGO_ROOT_PASSWORD=$(rand 32)"
echo "MONGO_APP_PASSWORD=$APP_PW"
echo "MONGODB_URI=mongodb://siteguard:${APP_PW}@mongo:27017/siteguard?replicaSet=rs0&authSource=siteguard"
