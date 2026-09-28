import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createGunzip, createGzip } from "node:zlib";
import mongoose from "mongoose";
import { connectDb } from "./connection";
import { ensureIndexes } from "./indexes";

const { EJSON } = mongoose.mongo.BSON;

/**
 * Portable backup: one folder per run, one gzip'd EJSON-lines file per
 * collection + a manifest. Needs only the Node driver (no mongodump), so it
 * works the same on Windows dev machines and in the Docker worker, and the
 * restore is covered by an automated test.
 *
 *   <dir>/siteguard-2026-09-28_0230/
 *     manifest.json
 *     sites.jsonl.gz
 *     checkResults.jsonl.gz
 *     …
 */
export interface BackupManifest {
  format: "siteguard-backup/1";
  createdAt: string;
  database: string;
  collections: Record<string, number>;
  bytes: number;
}

export interface BackupInfo {
  name: string;
  path: string;
  createdAt: Date;
  collections: number;
  documents: number;
  bytes: number;
}

const PREFIX = "siteguard-";

function stamp(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", "_").replace(":", "");
}

async function dbHandle() {
  await connectDb();
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB is not connected");
  return db;
}

/** Dump every collection (except system.*) into a new folder under `dir`. */
export async function createBackup(dir: string, now = new Date()): Promise<BackupInfo> {
  const db = await dbHandle();
  const name = `${PREFIX}${stamp(now)}`;
  const target = join(dir, name);
  await mkdir(target, { recursive: true });

  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .filter((c) => c.type !== "view" && !c.name.startsWith("system."))
    .map((c) => c.name)
    .sort();

  const counts: Record<string, number> = {};
  let bytes = 0;
  for (const coll of collections) {
    let n = 0;
    const cursor = db.collection(coll).find({}, { batchSize: 500 });
    async function* lines() {
      for await (const doc of cursor) {
        n++;
        yield `${EJSON.stringify(doc, { relaxed: false })}\n`;
      }
    }
    const file = join(target, `${coll}.jsonl.gz`);
    await pipeline(Readable.from(lines()), createGzip({ level: 6 }), createWriteStream(file));
    counts[coll] = n;
    bytes += (await stat(file)).size;
  }

  const manifest: BackupManifest = { format: "siteguard-backup/1", createdAt: now.toISOString(), database: db.databaseName, collections: counts, bytes };
  await writeFile(join(target, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { name, path: target, createdAt: now, collections: collections.length, documents: Object.values(counts).reduce((a, b) => a + b, 0), bytes };
}

async function readManifest(path: string): Promise<BackupManifest | null> {
  try {
    const m = JSON.parse(await readFile(join(path, "manifest.json"), "utf8")) as BackupManifest;
    return m.format === "siteguard-backup/1" ? m : null;
  } catch {
    return null;
  }
}

/** Complete backups in `dir`, newest first (a folder without a manifest = interrupted run, ignored). */
export async function listBackups(dir: string): Promise<BackupInfo[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: BackupInfo[] = [];
  for (const name of names.filter((n) => n.startsWith(PREFIX))) {
    const path = join(dir, name);
    const m = await readManifest(path);
    if (!m) continue;
    out.push({ name, path, createdAt: new Date(m.createdAt), collections: Object.keys(m.collections).length, documents: Object.values(m.collections).reduce((a, b) => a + b, 0), bytes: m.bytes });
  }
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Delete backups older than `keepDays`, always keeping the newest `minKeep`. Also removes interrupted runs older than a day. */
export async function pruneBackups(dir: string, keepDays: number, now = new Date(), minKeep = 1): Promise<string[]> {
  const removed: string[] = [];
  const backups = await listBackups(dir);
  const cutoff = now.getTime() - keepDays * 86_400_000;
  for (const b of backups.slice(minKeep)) {
    if (b.createdAt.getTime() < cutoff) {
      await rm(b.path, { recursive: true, force: true });
      removed.push(b.name);
    }
  }
  const complete = new Set(backups.map((b) => b.name));
  for (const name of (await readdir(dir).catch(() => [] as string[])).filter((n) => n.startsWith(PREFIX) && !complete.has(n))) {
    const path = join(dir, name);
    const age = now.getTime() - (await stat(path)).mtimeMs;
    if (age > 86_400_000) {
      await rm(path, { recursive: true, force: true });
      removed.push(name);
    }
  }
  return removed;
}

export interface RestoreResult {
  collections: Record<string, number>;
}

/**
 * Replace the database contents with a backup. Collections/indexes are
 * (re)created first — the time-series `checkResults` must exist before inserts —
 * then each collection is emptied and refilled. Collections not in the backup are left alone.
 */
export async function restoreBackup(path: string, opts: { log?: (msg: string) => void } = {}): Promise<RestoreResult> {
  const manifest = await readManifest(path);
  if (!manifest) throw new Error(`${path} is not a SiteGuard backup (manifest.json missing or unknown format)`);
  const db = await dbHandle();
  await ensureIndexes();

  const restored: Record<string, number> = {};
  for (const coll of Object.keys(manifest.collections)) {
    const collection = db.collection(coll);
    await collection.deleteMany({});
    let batch: Record<string, unknown>[] = [];
    let n = 0;
    const flush = async () => {
      if (!batch.length) return;
      await collection.insertMany(batch, { ordered: false });
      n += batch.length;
      batch = [];
    };
    const rl = createInterface({ input: createReadStream(join(path, `${coll}.jsonl.gz`)).pipe(createGunzip()), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      batch.push(EJSON.parse(line, { relaxed: false }) as Record<string, unknown>);
      if (batch.length >= 1000) await flush();
    }
    await flush();
    restored[coll] = n;
    if (n !== manifest.collections[coll]) throw new Error(`${coll}: restored ${n} documents, backup has ${manifest.collections[coll]}`);
    opts.log?.(`${coll}: ${n}`);
  }
  return { collections: restored };
}
