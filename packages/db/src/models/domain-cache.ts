import { Schema, model, type InferSchemaType } from "mongoose";
import { defineModel, type Lean } from "../model-utils";

/**
 * RDAP/WHOIS answers cached per registrable domain (client.co.in), so several
 * sites on one domain (www, blog., shop.) cause a single lookup.
 */
const domainCacheSchema = new Schema(
  {
    domain: { type: String, required: true, lowercase: true, trim: true },
    registrar: String,
    expiresAt: Date,
    registeredAt: Date,
    nameservers: { type: [String], default: [] },
    /** "rdap" | "whois" */
    source: String,
    /** Server that answered (RDAP base URL / WHOIS host). */
    server: String,
    /** Last lookup error (the previous good data is kept). */
    error: String,
    fetchedAt: { type: Date, required: true },
  },
  { collection: "domainCache", versionKey: false },
);

domainCacheSchema.index({ domain: 1 }, { unique: true });

export type DomainCacheDoc = InferSchemaType<typeof domainCacheSchema>;
export type DomainCacheLean = Lean<DomainCacheDoc>;

export const DomainCache = defineModel("DomainCache", () => model("DomainCache", domainCacheSchema));
