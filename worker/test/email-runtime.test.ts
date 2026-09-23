import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Regression: Vitest compiles JSX with the automatic runtime, but the worker runs
 * under `tsx`, which compiled @siteguard/emails with the classic runtime →
 * "React is not defined" in production only. Render once through real tsx.
 */
describe("email templates under the worker's tsx runtime", () => {
  it("render without 'React is not defined'", () => {
    const workerDir = join(dirname(fileURLToPath(import.meta.url)), "..");
    const tsxCli = createRequire(join(workerDir, "package.json")).resolve("tsx/cli");
    const out = execFileSync(process.execPath, [tsxCli, join(workerDir, "test/fixtures/render-email.ts")], { cwd: workerDir, encoding: "utf8", timeout: 60_000 });
    expect(JSON.parse(out.trim().split("\n").pop()!)).toEqual({ subject: "🔴 CRITICAL: Site is down — Acme (HTTP 503)", ok: true });
  });
});
