/**
 * Restore a backup made by `pnpm db:backup` / the nightly worker job.
 * REPLACES the contents of every collection in the backup. Stop the worker first.
 *
 *   pnpm db:restore                      → list available backups
 *   pnpm db:restore <name|path> --yes    → restore it
 */
import { isAbsolute, join } from "node:path";
import { loadRootEnv, resolveFromRoot } from "@siteguard/core/env";
import { disconnectDb, listBackups, restoreBackup } from "@siteguard/db";

loadRootEnv();
const dir = resolveFromRoot(process.env.BACKUP_DIR || "./.dev-data/backups");
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));

if (!target) {
  const backups = await listBackups(dir);
  if (!backups.length) console.log(`No backups in ${dir}. Create one with: pnpm db:backup`);
  for (const b of backups) console.log(`${b.name}   ${b.createdAt.toISOString()}   ${b.documents} docs   ${(b.bytes / 1024).toFixed(0)} KB`);
  if (backups.length) console.log(`\nRestore with: pnpm db:restore ${backups[0]!.name} --yes`);
  await disconnectDb();
  process.exit(0);
}

const path = isAbsolute(target) ? target : join(dir, target);
if (!args.includes("--yes")) {
  console.error(`This REPLACES the current database with ${path}.\nStop the worker (pnpm dev) first, then re-run with --yes.`);
  process.exit(1);
}
const res = await restoreBackup(path, { log: (m) => console.log(`  ${m}`) });
console.log(`✔ restored ${Object.keys(res.collections).length} collections from ${path}`);
await disconnectDb();
