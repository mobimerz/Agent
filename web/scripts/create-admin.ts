/**
 * Bootstrap (or promote) an ADMIN user. There is no public sign-up.
 *
 *   pnpm create-admin --email you@mycompany.com --name "Your Name" [--password "..."]
 *
 * Without --password a strong random one is generated and printed once.
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { loadRootEnv, parseEnv, webEnvSchema } from "@siteguard/core/env";
import { connectDb, disconnectDb, mongoose } from "@siteguard/db";
import { createAuth, MIN_PASSWORD_LENGTH } from "../lib/auth-config";

loadRootEnv();
const env = parseEnv(webEnvSchema);

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    password: { type: "string" },
  },
});

if (!values.email) {
  console.error('Usage: pnpm create-admin --email you@mycompany.com --name "Your Name" [--password "..."]');
  process.exit(1);
}

const email = values.email.trim().toLowerCase();
const name = values.name?.trim() || email.split("@")[0]!;
const generated = !values.password;
const password = values.password ?? randomBytes(15).toString("base64url");

if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  process.exit(1);
}

await connectDb(env.MONGODB_URI);
const auth = createAuth({ mongodbUri: env.MONGODB_URI, secret: env.AUTH_SECRET, baseURL: env.APP_URL });

const users = mongoose.connection.db!.collection("user");
const existing = await users.findOne({ email });

if (existing) {
  await users.updateOne({ _id: existing._id }, { $set: { role: "admin", updatedAt: new Date() } });
  console.log(`✔ ${email} already exists — role set to admin. (Password unchanged.)`);
} else {
  // Server-side call without request headers is allowed by the admin plugin.
  await auth.api.createUser({ body: { email, name, password, role: "admin" } });
  console.log(`✔ Admin created: ${email}`);
  if (generated) console.log(`  Password (shown once, change it after login): ${password}`);
}

await disconnectDb();
