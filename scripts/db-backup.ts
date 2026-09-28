/**
 * Back up the whole database now (the worker also does this nightly).
 *
 *   pnpm db:backup
 */
import { loadRootEnv, resolveFromRoot } from "@siteguard/core/env";
import { createBackup, disconnectDb, pruneBackups } from "@siteguard/db";

loadRootEnv();
const dir = resolveFromRoot(process.env.BACKUP_DIR || "./.dev-data/backups");
const keepDays = Number(process.env.BACKUP_KEEP_DAYS || 7);

const b = await createBackup(dir);
console.log(`✔ ${b.name}: ${b.collections} collections, ${b.documents} documents, ${(b.bytes / 1024).toFixed(0)} KB`);
console.log(`  ${b.path}`);
const removed = await pruneBackups(dir, keepDays);
if (removed.length) console.log(`  removed backups older than ${keepDays} days: ${removed.join(", ")}`);
await disconnectDb();
