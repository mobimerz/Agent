import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/test/**/*.test.ts", "worker/**/*.test.ts", "web/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    // DB tests start a real mongod replica set (mongodb-memory-server).
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
