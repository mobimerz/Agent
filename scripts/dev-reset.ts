/** Wipe all local dev data (.dev-data: MongoDB files, screenshots, logs). */
import { existsSync, rmSync } from "node:fs";
import { DEV_DATA_DIR, devMongoState } from "./lib/dev";

if ((await devMongoState()) === "ours") {
  console.error("Dev MongoDB is still running. Stop `pnpm dev` / `pnpm dev:db` first, then run `pnpm dev:reset` again.");
  process.exit(1);
}

if (!existsSync(DEV_DATA_DIR)) {
  console.log("Nothing to reset (.dev-data does not exist).");
} else {
  rmSync(DEV_DATA_DIR, { recursive: true, force: true });
  console.log(`Removed ${DEV_DATA_DIR}. Next \`pnpm dev\` starts with an empty database — run \`pnpm create-admin\` again.`);
}
