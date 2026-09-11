"use client";

// Team's Assistant entry point — see src/components/AssistantExperience.tsx
// for the actual rebuilt flow/identity. This file just wires it into the
// Team route with Team's own BottomNav and send-home target.

import AssistantExperience from "@/components/AssistantExperience";
import BottomNav from "@/components/BottomNav";

export default function AssistantPage() {
  return (
    <div className="flex-1 flex flex-col">
      <AssistantExperience variant="team" afterCreateHref="/" />
      <BottomNav />
    </div>
  );
}
