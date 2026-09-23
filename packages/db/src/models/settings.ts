import { DEFAULTS, DEFAULT_INTERVALS, DEFAULT_THRESHOLDS, DEFAULT_TIMEZONE } from "@siteguard/core";
import { Schema, model, type InferSchemaType } from "mongoose";
import { defineModel } from "../model-utils";

export const SETTINGS_ID = "global";

const intervalFields = Object.fromEntries(
  Object.entries(DEFAULT_INTERVALS).map(([k, v]) => [k, { type: Number, default: v, min: 60 }]),
) as Record<keyof typeof DEFAULT_INTERVALS, { type: NumberConstructor; default: number; min: number }>;

const thresholdFields = Object.fromEntries(
  Object.entries(DEFAULT_THRESHOLDS).map(([k, v]) => [k, { type: Number, default: v }]),
) as Record<keyof typeof DEFAULT_THRESHOLDS, { type: NumberConstructor; default: number }>;

/**
 * Singleton (`_id: "global"`) holding everything editable in the Settings UI.
 * .env values act as the initial defaults; this document wins once saved.
 */
const settingsSchema = new Schema(
  {
    _id: { type: String, default: SETTINGS_ID },
    timezone: { type: String, default: DEFAULT_TIMEZONE },
    alertEmails: { type: [String], default: [] },
    /** Empty → use TELEGRAM_CHAT_ID from .env. */
    telegramChatIds: { type: [String], default: [] },
    reports: {
      morning: { type: String, default: DEFAULTS.reportMorning },
      night: { type: String, default: DEFAULTS.reportNight },
      emailEnabled: { type: Boolean, default: true },
      telegramEnabled: { type: Boolean, default: true },
    },
    intervals: { type: new Schema(intervalFields, { _id: false }), default: () => ({}) },
    thresholds: { type: new Schema(thresholdFields, { _id: false }), default: () => ({}) },
    alerts: {
      confirmRetries: { type: Number, default: DEFAULTS.confirmRetries },
      confirmRetryDelaySec: { type: Number, default: DEFAULTS.confirmRetryDelaySec },
      reminderAfterMin: { type: Number, default: DEFAULTS.reminderAfterMin },
      groupThreshold: { type: Number, default: DEFAULTS.groupThreshold },
      groupWindowMin: { type: Number, default: DEFAULTS.groupWindowMin },
      resolveAfterOks: { type: Number, default: DEFAULTS.resolveAfterOks },
      warnConfirmRuns: { type: Number, default: DEFAULTS.warnConfirmRuns },
      flapThreshold: { type: Number, default: DEFAULTS.flapThreshold },
      flapWindowMin: { type: Number, default: DEFAULTS.flapWindowMin },
      stableAfterMin: { type: Number, default: DEFAULTS.stableAfterMin },
      watchdogStaleMin: { type: Number, default: DEFAULTS.watchdogStaleMin },
    },
    email: {
      dailyLimit: { type: Number, default: DEFAULTS.emailDailyLimit },
      reservedForReports: { type: Number, default: DEFAULTS.emailReservedForReports },
      digestAfter: { type: Number, default: DEFAULTS.emailDigestAfter },
      digestIntervalMin: { type: Number, default: DEFAULTS.digestIntervalMin },
    },
    linksMaxPages: { type: Number, default: DEFAULTS.linksMaxPages },
    screenshotsKeep: { type: Number, default: DEFAULTS.screenshotsKeep },
  },
  { timestamps: true, collection: "settings" },
);

export type SettingsDoc = InferSchemaType<typeof settingsSchema>;

export const Settings = defineModel("Settings", () => model("Settings", settingsSchema));

/** Read the singleton, creating it with defaults on first use. */
export async function getSettings(): Promise<SettingsDoc> {
  const doc = await Settings.findOneAndUpdate(
    { _id: SETTINGS_ID },
    { $setOnInsert: { _id: SETTINGS_ID } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  ).lean();
  return doc as SettingsDoc;
}
