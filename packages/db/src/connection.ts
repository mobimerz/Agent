import mongoose from "mongoose";

type MongoClient = InstanceType<typeof mongoose.mongo.MongoClient>;

interface DbCache {
  uri?: string;
  client?: MongoClient;
  ready?: Promise<typeof mongoose>;
}

/**
 * Cached on globalThis so Next.js dev hot-reload and repeated imports reuse
 * one connection pool instead of leaking a new one per reload.
 */
const g = globalThis as typeof globalThis & { __siteguardDb?: DbCache };
const cache: DbCache = (g.__siteguardDb ??= {});

mongoose.set("strictQuery", true);

function resolveUri(uri?: string): string {
  const value = uri ?? process.env.MONGODB_URI;
  if (!value) throw new Error("MONGODB_URI is not set");
  if (cache.uri && cache.uri !== value) throw new Error("Already connected with a different MONGODB_URI");
  return value;
}

/**
 * The single MongoClient shared by Mongoose and Better Auth. Returned
 * synchronously (not yet connected); the driver connects on first use and
 * `connectDb()` connects it explicitly and attaches Mongoose to it.
 */
export function getMongoClient(uri?: string): MongoClient {
  if (cache.client) return cache.client;
  cache.uri = resolveUri(uri);
  cache.client = new mongoose.mongo.MongoClient(cache.uri, {
    appName: process.env.SITEGUARD_APP_NAME ?? "siteguard",
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 15_000,
  });
  return cache.client;
}

/** Connect once and reuse. Safe to call from every request / job. */
export function connectDb(uri?: string): Promise<typeof mongoose> {
  cache.ready ??= (async () => {
    const client = getMongoClient(uri);
    await client.connect();
    if (mongoose.connection.readyState === mongoose.ConnectionStates.disconnected) {
      mongoose.connection.setClient(client);
    }
    return mongoose;
  })().catch((err: unknown) => {
    cache.ready = undefined;
    throw err;
  });
  return cache.ready;
}

export async function disconnectDb(): Promise<void> {
  const client = cache.client;
  cache.ready = undefined;
  cache.client = undefined;
  cache.uri = undefined;
  await mongoose.connection.close().catch(() => {});
  await client?.close();
}

/** Round-trip ping; used by /api/health. */
export async function pingDb(timeoutMs = 3000): Promise<boolean> {
  try {
    await connectDb();
    const db = mongoose.connection.db;
    if (!db) return false;
    await Promise.race([
      db.admin().ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("ping timeout")), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}
