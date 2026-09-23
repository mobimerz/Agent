import "server-only";
import { connectDb } from "@siteguard/db";
import { env } from "./env";

/** Await before any Mongoose query in server code. Cached; cheap after the first call. */
export function db() {
  return connectDb(env.MONGODB_URI);
}
