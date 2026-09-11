import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseServer";
import { getTreasuryBalance } from "@/lib/treasury";

// GET — balance, all projects, the active proposal (with project joined),
// and the plea history for that proposal.
export async function GET() {
  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const [balance, { data: projects }, { data: activeProposal }] = await Promise.all([
    getTreasuryBalance(db),
    db.from("war_chest_projects").select("*").order("created_at", { ascending: true }),
    db.from("war_chest_proposals").select("*").eq("status", "active").maybeSingle(),
  ]);

  let proposal = null;
  let pleas: unknown[] = [];
  if (activeProposal) {
    const { data: project } = await db.from("war_chest_projects").select("*").eq("id", activeProposal.project_id).single();
    const { data: pleaRows } = await db
      .from("war_chest_pleas")
      .select("*")
      .eq("proposal_id", activeProposal.id)
      .order("created_at", { ascending: true });
    proposal = { ...activeProposal, project: project ?? null };
    pleas = pleaRows ?? [];
  }

  return NextResponse.json({
    ok: true,
    balance,
    projects: projects ?? [],
    proposal,
    pleas,
  });
}
