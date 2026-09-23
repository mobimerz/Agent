import path from "node:path";
import type { NextConfig } from "next";
import { loadRootEnv } from "@siteguard/core/env";

// One .env at the repo root is shared by web, worker and docker-compose.
loadRootEnv(__dirname);

const repoRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  transpilePackages: ["@siteguard/core", "@siteguard/db"],
  serverExternalPackages: ["mongoose", "mongodb", "pino"],
  poweredByHeader: false,
  typedRoutes: true,
};

export default nextConfig;
