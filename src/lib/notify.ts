// notify() — the one helper every server route uses to tell a partner
// something happened: writes the notifications row (drives the in-app
// inbox) AND fires a push (drives the lockscreen alert). Never call
// sendPushToUser directly from a route — always go through this so the
// inbox and the push never drift out of sync.

import { createSupabaseAdminClient } from "./supabaseServer";
import { sendPushToUser } from "./push";

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  relatedFineId?: string;
  relatedTaskId?: string;
}

export async function notify(input: NotifyInput): Promise<void> {
  const db = createSupabaseAdminClient();
  if (!db) return;

  const { data: row } = await db
    .from("notifications")
    .insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      related_fine_id: input.relatedFineId ?? null,
      related_task_id: input.relatedTaskId ?? null,
    })
    .select()
    .single();

  const result = await sendPushToUser(input.userId, { title: input.title, body: input.body, tag: input.type });

  if (row) {
    await db
      .from("notifications")
      .update({ push_sent_count: result.sent, push_pruned_count: result.pruned })
      .eq("id", row.id);
  }
}
