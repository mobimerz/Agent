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
    // Worker modules validate env at import; tests never touch this URI (they start their own mongod).
    env: { NODE_ENV: "test", LOG_LEVEL: "silent", MONGODB_URI: "mongodb://127.0.0.1:1/unused" },
  },
});
