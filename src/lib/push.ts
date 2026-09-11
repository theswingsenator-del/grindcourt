// Server-side push sender. Subscriptions live in Supabase (push_subscriptions),
// scoped per user_id so each partner gets only their own notifications.

import webpush from "web-push";
import { createSupabaseAdminClient } from "./supabaseServer";

function configureVapid(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:hello@samandjaytech.com";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
}

// Sends to every subscription belonging to userId; prunes dead ones (410/404).
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; pruned: number }> {
  if (!configureVapid()) return { sent: 0, pruned: 0 };
  const db = createSupabaseAdminClient();
  if (!db) return { sent: 0, pruned: 0 };

  const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", userId);
  if (!subs || subs.length === 0) return { sent: 0, pruned: 0 };

  let sent = 0;
  let pruned = 0;

  await Promise.all(
    subs.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(payload)
        );
        sent += 1;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.from("push_subscriptions").delete().eq("endpoint", row.endpoint);
          pruned += 1;
        }
      }
    })
  );

  return { sent, pruned };
}
