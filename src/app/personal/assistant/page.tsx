"use client";

// Personal's Assistant — same component as Team's, cooler register comes
// for free from .personal-scope (see src/app/personal/layout.tsx). No
// BottomNav import here — PersonalBottomNav is already rendered by the
// layout around every /personal/* page.

import AssistantExperience from "@/components/AssistantExperience";

export default function PersonalAssistantPage() {
  return <AssistantExperience variant="personal" afterCreateHref="/personal" />;
}
