#!/bin/bash
# Runs once, on first boot with an empty data dir (docker-entrypoint-initdb.d).
# Creates the least-privilege application user used by web + worker.
set -euo pipefail

: "${MONGO_APP_DB:=siteguard}"
: "${MONGO_APP_USER:?MONGO_APP_USER is required}"
: "${MONGO_APP_PASSWORD:?MONGO_APP_PASSWORD is required}"

mongosh --quiet \
  -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin \
  --eval '
    const dbName = process.env.MONGO_APP_DB;
    const appDb = db.getSiblingDB(dbName);
    if (!appDb.getUser(process.env.MONGO_APP_USER)) {
      appDb.createUser({
        user: process.env.MONGO_APP_USER,
        pwd: process.env.MONGO_APP_PASSWORD,
        // readWrite for data; dbAdmin to create the time-series collection and indexes.
        roles: [{ role: "readWrite", db: dbName }, { role: "dbAdmin", db: dbName }],
      });
      print("created app user " + process.env.MONGO_APP_USER + " on " + dbName);
    }
  '
