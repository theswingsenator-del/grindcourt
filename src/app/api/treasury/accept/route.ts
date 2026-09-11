import { NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { getTreasuryBalance } from "@/lib/treasury";
import { notify } from "@/lib/notify";
import { formatNaira } from "@/lib/fines";

// POST — marks the active proposal accepted and its project funded. Only
// allowed once the treasury balance covers the project's cost.
export async function POST() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: proposal } = await db.from("war_chest_proposals").select("*").eq("status", "active").maybeSingle();
  if (!proposal) {
    return NextResponse.json({ ok: false, error: "no active proposal to accept" }, { status: 400 });
  }

  const { data: project } = await db.from("war_chest_projects").select("*").eq("id", proposal.project_id).single();
  if (!project) return NextResponse.json({ ok: false, error: "project not found" }, { status: 404 });

  const balance = await getTreasuryBalance(db);
  if (balance < project.cost_naira) {
    return NextResponse.json(
      { ok: false, error: `treasury balance ${formatNaira(balance)} does not yet cover ${formatNaira(project.cost_naira)}` },
      { status: 400 }
    );
  }

  await db.from("war_chest_proposals").update({ status: "accepted" }).eq("id", proposal.id);
  await db.from("war_chest_projects").update({ status: "funded" }).eq("id", project.id);

  const { data: users } = await db.from("app_users").select("*");
  for (const u of users ?? []) {
    await notify({
      userId: u.id,
      type: "treasury_funded",
      title: "Initiative funded",
      body: `"${project.name}" is funded — ${formatNaira(project.cost_naira)} accepted by ${me.display_name}.`,
    });
  }

  return NextResponse.json({ ok: true, project: { ...project, status: "funded" } });
}
