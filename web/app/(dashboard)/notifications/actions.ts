"use server";

import { revalidatePath } from "next/cache";
import { mongoose, Notification } from "@siteguard/db";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";

export async function markNotificationRead(id: string): Promise<void> {
  const session = await requireSession();
  if (!mongoose.isValidObjectId(id)) return;
  await db();
  await Notification.updateOne({ _id: id }, { $addToSet: { readBy: session.user.id } });
  revalidatePath("/notifications");
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  const session = await requireSession();
  await db();
  const res = await Notification.updateMany({ userId: null, readBy: { $ne: session.user.id } }, { $addToSet: { readBy: session.user.id } });
  revalidatePath("/notifications");
  return { updated: res.modifiedCount };
}
