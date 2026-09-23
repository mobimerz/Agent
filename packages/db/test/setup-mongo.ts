import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { connectDb, disconnectDb } from "../src";

/** Same MongoDB version as dev and production. */
export const TEST_MONGO_VERSION = "8.0.32";

/** Start a throwaway single-node replica set (needed for time-series + transactions + change streams). */
export async function startTestDb() {
  const replSet = await MongoMemoryReplSet.create({
    binary: { version: TEST_MONGO_VERSION },
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const uri = replSet.getUri("siteguard_test");
  await connectDb(uri);
  return {
    uri,
    async stop() {
      await disconnectDb();
      await replSet.stop();
    },
  };
}
