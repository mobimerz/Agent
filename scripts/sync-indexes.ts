/** Create collections and sync all indexes to match the Mongoose schemas. */
import { loadRootEnv } from "@siteguard/core/env";
import { disconnectDb, ensureIndexes, listIndexes } from "@siteguard/db";

loadRootEnv();
const dropped = await ensureIndexes();
const all = await listIndexes();
for (const [coll, names] of Object.entries(all)) {
  const d = dropped[coll]?.length ? `  (dropped stale: ${dropped[coll]!.join(", ")})` : "";
  console.log(`${coll.padEnd(20)} ${names.join(", ")}${d}`);
}
await disconnectDb();
