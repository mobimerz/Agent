/**
 * Local dev MongoDB: a real `mongod` (downloaded once by mongodb-memory-server)
 * running as single-node replica set `rs0` with a PERSISTENT data dir in
 * `.dev-data/mongo`, so sites/results survive restarts. `pnpm dev:reset` wipes it.
 * Production uses the Docker image instead (deploy/docker-compose.yml).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { MongoBinary } from "mongodb-memory-server-core";
import { MongoClient } from "mongodb";
import { DEV_DATA_DIR, DEV_MONGO_DIR, DEV_MONGO_PORT, DEV_MONGO_VERSION, devMongoState, sleep } from "./lib/dev";
import { join } from "node:path";

const HOST = `127.0.0.1:${DEV_MONGO_PORT}`;
const URI = `mongodb://${HOST}/?directConnection=true`;

async function main() {
  const state = await devMongoState();
  if (state === "ours") {
    console.log(`[db] SiteGuard dev mongod already running on ${HOST} — reusing it.`);
    setInterval(() => {}, 1 << 30);
    return;
  }
  if (state === "foreign") {
    console.error(`[db] Port ${DEV_MONGO_PORT} is used by a different MongoDB. Stop it or change DEV_MONGO_PORT in scripts/lib/dev.ts (and MONGODB_URI in .env).`);
    process.exit(1);
  }

  mkdirSync(DEV_MONGO_DIR, { recursive: true });
  console.log(`[db] resolving mongod ${DEV_MONGO_VERSION} (first run downloads it once into ~/.cache/mongodb-binaries)…`);
  const binary = await MongoBinary.getPath({ version: DEV_MONGO_VERSION });

  const logFile = join(DEV_DATA_DIR, "mongod.log");
  const out = openSync(logFile, "a");
  const child: ChildProcess = spawn(
    binary,
    [
      "--dbpath", DEV_MONGO_DIR,
      "--port", String(DEV_MONGO_PORT),
      "--bind_ip", "127.0.0.1",
      "--replSet", "rs0",
      "--wiredTigerCacheSizeGB", "0.5",
      "--setParameter", "diagnosticDataCollectionEnabled=false",
    ],
    { stdio: ["ignore", out, out] },
  );

  let stopping = false;
  child.on("exit", (code) => {
    if (!stopping) console.error(`[db] mongod exited unexpectedly (code ${code}). See ${logFile}`);
    process.exit(code ?? 1);
  });

  // Wait for mongod to accept connections.
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 1000 });
  for (let i = 0; ; i++) {
    try {
      await client.connect();
      await client.db("admin").command({ ping: 1 });
      break;
    } catch (err) {
      if (i > 60) throw err;
      await sleep(500);
    }
  }

  // Initiate the replica set once; on later starts the config is already in the data dir.
  try {
    await client.db("admin").command({ replSetGetStatus: 1 });
  } catch (err) {
    if ((err as { code?: number }).code !== 94 /* NotYetInitialized */) throw err;
    console.log("[db] initiating replica set rs0…");
    await client.db("admin").command({ replSetInitiate: { _id: "rs0", members: [{ _id: 0, host: HOST }] } });
  }
  for (let i = 0; ; i++) {
    const hello = await client.db("admin").command({ hello: 1 });
    if (hello.isWritablePrimary) break;
    if (i > 60) throw new Error("replica set did not become primary");
    await sleep(500);
  }
  await client.close();

  console.log(`[db] ready → mongodb://${HOST}/siteguard?directConnection=true  (data: ${DEV_MONGO_DIR})`);

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log("[db] shutting down mongod cleanly…");
    const c = new MongoClient(URI, { serverSelectionTimeoutMS: 2000 });
    try {
      await c.connect();
      await c.db("admin").command({ shutdown: 1 });
    } catch {
      // Expected: the server closes the socket while shutting down.
    } finally {
      await c.close().catch(() => {});
    }
    setTimeout(() => child.kill(), 10_000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGBREAK", shutdown); // Windows console close / Ctrl+Break
}

main().catch((err) => {
  console.error("[db] failed:", err);
  process.exit(1);
});
