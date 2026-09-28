"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SETTINGS_ID, Settings } from "@siteguard/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24 h), e.g. 09:00");
const int = (min: number, max: number) => z.coerce.number().int().min(min, `Min ${min}`).max(max, `Max ${max}`);
const list = (item: z.ZodType<string, string>) =>
  z.string().transform((s) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean)).pipe(z.array(item).max(20, "At most 20"));

// Not exported: a "use server" module may only export async functions (and types).
const alertSettingsSchema = z
  .object({
    morning: hm,
    night: hm,
    reportEmail: z.boolean(),
    reportTelegram: z.boolean(),
    alertEmails: list(z.email("Invalid email")),
    telegramChatIds: list(z.string().regex(/^-?\d+$|^@\w+$/, "Chat IDs are numbers (groups start with -100…) or @channel")),
    responseTimeWarnMs: int(200, 60_000),
    minPerformance: int(0, 100),
    minSeo: int(0, 100),
    sslWarnDays: int(1, 90),
    sslFailDays: int(0, 60),
    domainWarnDays: int(1, 120),
    domainFailDays: int(0, 60),
    reminderAfterMin: int(15, 24 * 60),
  })
  .refine((v) => v.morning !== v.night, { path: ["night"], message: "Morning and night reports need different times" })
  .refine((v) => v.sslFailDays < v.sslWarnDays, { path: ["sslFailDays"], message: "Must be lower than the warning days" })
  .refine((v) => v.domainFailDays < v.domainWarnDays, { path: ["domainFailDays"], message: "Must be lower than the warning days" });

export type AlertSettingsInput = z.input<typeof alertSettingsSchema>;

export async function saveAlertSettings(input: AlertSettingsInput): Promise<{ ok: true } | { ok: false; error: string; fieldErrors: Record<string, string> }> {
  await requireAdmin();
  const parsed = alertSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const v = parsed.data;
  await db();
  await Settings.updateOne(
    { _id: SETTINGS_ID },
    {
      $set: {
        "reports.morning": v.morning,
        "reports.night": v.night,
        "reports.emailEnabled": v.reportEmail,
        "reports.telegramEnabled": v.reportTelegram,
        alertEmails: v.alertEmails,
        telegramChatIds: v.telegramChatIds,
        "thresholds.responseTimeWarnMs": v.responseTimeWarnMs,
        "thresholds.minPerformance": v.minPerformance,
        "thresholds.minSeo": v.minSeo,
        "thresholds.sslWarnDays": v.sslWarnDays,
        "thresholds.sslFailDays": v.sslFailDays,
        "thresholds.domainWarnDays": v.domainWarnDays,
        "thresholds.domainFailDays": v.domainFailDays,
        "alerts.reminderAfterMin": v.reminderAfterMin,
      },
    },
    { upsert: true },
  );
  revalidatePath("/settings/alerts");
  revalidatePath("/reports");
  return { ok: true };
}
