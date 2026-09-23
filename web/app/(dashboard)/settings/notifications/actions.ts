"use server";

import { sendTestEmail, sendTestTelegram, type SendOutcome } from "@siteguard/notify";
import { notifyContext } from "@/lib/notify";
import { requireAdmin } from "@/lib/session";

export async function sendTestEmailAction(): Promise<SendOutcome> {
  const session = await requireAdmin();
  return sendTestEmail(await notifyContext(), session.user.name);
}

export async function sendTestTelegramAction(): Promise<SendOutcome> {
  const session = await requireAdmin();
  return sendTestTelegram(await notifyContext(), session.user.name);
}
