import { loadRootEnv, parseEnv, workerEnvSchema } from "@siteguard/core/env";

loadRootEnv();
export const env = parseEnv(workerEnvSchema);
