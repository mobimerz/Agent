import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DEV_DATA_DIR = join(ROOT, ".dev-data");
export const DEV_MONGO_DIR = join(DEV_DATA_DIR, "mongo");
export const DEV_MONGO_PORT = 27027;
/** Keep in sync with the image tag in deploy/docker-compose.yml. */
export const DEV_MONGO_VERSION = "8.0.32";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * "none"    → nothing listening on the dev port
 * "ours"    → a mongod using our .dev-data/mongo dir
 * "foreign" → some other MongoDB owns the port (never touch it)
 */
export async function devMongoState(): Promise<"none" | "ours" | "foreign"> {
  const client = new MongoClient(`mongodb://127.0.0.1:${DEV_MONGO_PORT}/?directConnection=true`, {
    serverSelectionTimeoutMS: 800,
    connectTimeoutMS: 800,
  });
  try {
    await client.connect();
    const opts = await client.db("admin").command({ getCmdLineOpts: 1 });
    const dbPath = opts.parsed?.storage?.dbPath as string | undefined;
    return dbPath && resolve(dbPath).toLowerCase() === resolve(DEV_MONGO_DIR).toLowerCase() ? "ours" : "foreign";
  } catch (err) {
    return (err as Error).name === "MongoServerSelectionError" ? "none" : "foreign";
  } finally {
    await client.close().catch(() => {});
  }
}
