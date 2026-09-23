import { CHECK_REASONS, CHECK_STATUSES, FRAMEWORKS, SITE_HEALTH, SITE_STATUSES } from "@siteguard/core";
import { Schema, model, type InferSchemaType } from "mongoose";
import { defineModel, type Lean } from "../model-utils";

/** Per-site override for one check. `intervalSec` unset → use global setting. */
const checkConfig = new Schema(
  {
    enabled: { type: Boolean, default: true },
    intervalSec: { type: Number, min: 60 },
  },
  { _id: false },
);

const checkSummary = new Schema(
  {
    status: { type: String, enum: CHECK_STATUSES, required: true },
    reason: { type: String, enum: CHECK_REASONS },
    message: { type: String, default: "" },
    checkedAt: { type: Date, required: true },
  },
  { _id: false },
);

const siteSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    /** Normalized with `normalizeSiteUrl` before save. */
    url: { type: String, required: true, trim: true },
    clientName: { type: String, trim: true, default: "" },
    clientEmail: { type: String, trim: true, lowercase: true, default: "" },
    tags: { type: [String], default: [] },
    notes: { type: String, default: "" },
    framework: { type: String, enum: [...FRAMEWORKS, null], default: null },
    status: { type: String, enum: SITE_STATUSES, default: "active" },

    checks: {
      type: new Schema(
        {
          uptime: { type: checkConfig, default: () => ({}) },
          content: { type: checkConfig, default: () => ({}) },
          ssl: { type: checkConfig, default: () => ({}) },
          domain: { type: checkConfig, default: () => ({}) },
          dns: { type: checkConfig, default: () => ({}) },
          pagespeed: { type: checkConfig, default: () => ({}) },
          seo: { type: checkConfig, default: () => ({}) },
          links: { type: checkConfig, default: () => ({}) },
          // Browser-based checks are opt-in: they are the heaviest on the VM.
          form: { type: checkConfig, default: () => ({ enabled: false }) },
          browser: { type: checkConfig, default: () => ({}) },
          headers: { type: checkConfig, default: () => ({}) },
        },
        { _id: false },
      ),
      default: () => ({}),
    },

    /** Per-site threshold overrides; unset fields fall back to global settings. */
    thresholds: {
      type: new Schema(
        {
          responseTimeWarnMs: Number,
          minPerformance: Number,
          minSeo: Number,
          minAccessibility: Number,
          minBestPractices: Number,
          scoreDropPoints: Number,
          sslWarnDays: Number,
          sslFailDays: Number,
          domainWarnDays: Number,
          domainFailDays: Number,
          pageSizeChangeRatio: Number,
        },
        { _id: false },
      ),
      default: () => ({}),
    },

    content: {
      type: new Schema(
        {
          requiredKeyword: { type: String, default: "" },
          extraSpamWords: { type: [String], default: [] },
        },
        { _id: false },
      ),
      default: () => ({}),
    },

    /** Extra paths (or absolute URLs on the same site) checked by the uptime check, e.g. "/contact". */
    importantPages: { type: [String], default: [] },

    form: {
      type: new Schema(
        {
          pageUrl: { type: String, default: "" },
          selector: { type: String, default: "form" },
          /** Actually submits `[SITEGUARD-TEST]` data. Off by default — it emails the client. */
          testSubmission: { type: Boolean, default: false },
          successText: { type: String, default: "" },
        },
        { _id: false },
      ),
      default: () => ({}),
    },

    links: {
      type: new Schema({ maxPages: { type: Number, min: 1, max: 500 } }, { _id: false }),
      default: () => ({}),
    },

    /** Denormalized latest state so the overview is a single query. Written by the worker. */
    current: {
      type: new Schema(
        {
          health: { type: String, enum: SITE_HEALTH, default: "unknown" },
          /** Uptime FAIL confirmed by re-checks (drives "down"; Phase 3 opens the incident). */
          uptimeDown: { type: Boolean, default: false },
          finalUrl: String,
          lastCheckedAt: Date,
          statusCode: Number,
          responseTimeMs: Number,
          perfMobile: Number,
          perfDesktop: Number,
          seoScore: Number,
          sslDaysLeft: Number,
          domainDaysLeft: Number,
          openIncidents: { type: Number, default: 0 },
          checks: { type: Map, of: checkSummary, default: () => new Map() },
        },
        { _id: false },
      ),
      default: () => ({}),
    },

    /** Flap detection state (see worker/src/incidents). */
    alerting: {
      type: new Schema(
        {
          /** Recent incident open/resolve times (last flapWindow). */
          transitions: { type: [Date], default: [] },
          unstable: { type: Boolean, default: false },
          unstableSince: Date,
        },
        { _id: false },
      ),
      default: () => ({}),
    },

    createdBy: { type: String },
  },
  { timestamps: true, collection: "sites" },
);

siteSchema.index({ url: 1 }, { unique: true });
siteSchema.index({ status: 1, tags: 1 });
siteSchema.index({ clientName: 1 });
siteSchema.index({ "current.health": 1 });
siteSchema.index({ "alerting.unstable": 1 });
siteSchema.index({ name: "text", clientName: "text", url: "text", tags: "text" });

export type SiteDoc = InferSchemaType<typeof siteSchema>;
export type SiteLean = Lean<SiteDoc>;

export const Site = defineModel("Site", () => model("Site", siteSchema));
