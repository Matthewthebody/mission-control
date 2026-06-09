import type { SharedJobDetailResponse } from "./jobTruthTypes";

export type JobPriorIntelligenceKind =
  | "parking"
  | "load_in"
  | "school_quirk"
  | "sports_flow"
  | "graduation_stage"
  | "reference_photo"
  | "production_note"
  | "client_success_note"
  | "known_risk"
  | "lesson";

export type JobPriorIntelligenceTone = "info" | "success" | "warning";

export type JobPriorIntelligenceItem = {
  id: string;
  kind: JobPriorIntelligenceKind;
  label: string;
  title: string;
  summary: string;
  source: string;
  updatedAt: string | null;
  owner: string;
  tone: JobPriorIntelligenceTone;
  href?: string;
};

export type JobPriorIntelligenceView = {
  items: JobPriorIntelligenceItem[];
  emptyTitle: string;
  emptySummary: string;
};

const DEMO_PRIOR_INTELLIGENCE: JobPriorIntelligenceItem[] = [
  {
    id: "north-high-parking-load-in",
    kind: "parking",
    label: "Parking and load-in",
    title: "North High uses the front office entrance",
    summary: "Use the staff lot and check in at the front office before unloading. The bus lane is tight after 7:45 AM.",
    source: "North High organization memory",
    updatedAt: "2026-03-18",
    owner: "Schools",
    tone: "info",
    href: "#directory/organizations?organization=org-school&tab=operations"
  },
  {
    id: "north-high-prior-year-lesson",
    kind: "lesson",
    label: "Prior-year lesson",
    title: "Run ID card work before lunch",
    summary: "Last year's roster changes slowed ID cards after lunch. Confirm late adds before the first class rotation.",
    source: "2025 picture day closeout",
    updatedAt: "2025-09-16",
    owner: "Schools",
    tone: "warning"
  },
  {
    id: "north-high-contact-preference",
    kind: "client_success_note",
    label: "Contact preference",
    title: "Jamie prefers Friday noon confirmations",
    summary: "Send the final arrival, roster, and room-use confirmation before Friday noon so the office can brief teachers.",
    source: "Client Success note",
    updatedAt: "2026-04-02",
    owner: "Client Success",
    tone: "info",
    href: "#directory/organizations?organization=org-school&tab=touchpoints"
  },
  {
    id: "north-high-setup-reference",
    kind: "reference_photo",
    label: "Reference photo",
    title: "Main Gym three-station setup",
    summary: "Best reference shows three camera stations along the east wall with admin table near the south entrance.",
    source: "Resource Library best reference",
    updatedAt: "2025-09-14",
    owner: "Photography",
    tone: "success",
    href: "#studios/job-prep"
  },
  {
    id: "metro-football-team-flow",
    kind: "sports_flow",
    label: "Sports flow",
    title: "Separate varsity and JV QR lanes",
    summary: "Use QR check-in by team. Keep varsity and JV in separate lanes so banner selections do not get mixed.",
    source: "Metro Football resource note",
    updatedAt: "2026-05-12",
    owner: "Sports",
    tone: "info",
    href: "#directory/organizations?organization=org-sports&tab=operations"
  },
  {
    id: "metro-football-production-note",
    kind: "production_note",
    label: "Production note",
    title: "Confirm banner crop before QA",
    summary: "Prior media day needed tighter banner crops. Production should confirm the template before peer review.",
    source: "Similar past sports job",
    updatedAt: "2025-08-24",
    owner: "Production",
    tone: "warning",
    href: "#sports/shoots/job-sports-1?tab=production"
  },
  {
    id: "metro-football-risk",
    kind: "known_risk",
    label: "Known risk",
    title: "Sponsor proofs drive client confidence",
    summary: "Sponsor banner proofs should go out first. Delays here create extra calls for Sports and Client Success.",
    source: "Client Success follow-up",
    updatedAt: "2026-05-15",
    owner: "Client Success",
    tone: "warning"
  },
  {
    id: "metro-football-reference",
    kind: "reference_photo",
    label: "Reference photo",
    title: "Stadium A tunnel team-photo reference",
    summary: "Best reference uses tunnel shade before noon. Avoid the west sideline after the sun clears the press box.",
    source: "Resource Library best reference",
    updatedAt: "2025-08-20",
    owner: "Photography",
    tone: "success",
    href: "#studios/job-prep?job=job-sports-1"
  },
  {
    id: "graduation-stage-position",
    kind: "graduation_stage",
    label: "Graduation stage note",
    title: "Stage-left grip-and-grin position works best",
    summary: "Place the photo station stage-left after diploma handoff. Keep a second shooter near the center aisle for family reactions.",
    source: "Graduation closeout memory",
    updatedAt: "2025-06-02",
    owner: "Photography",
    tone: "info",
    href: "#studios/job-prep"
  }
];

export function buildJobPriorIntelligence(detail: SharedJobDetailResponse): JobPriorIntelligenceView {
  const organizationId = detail.job.organization_id;
  const title = `${detail.job.title} ${detail.job.event_name ?? ""}`.toLowerCase();
  const jobCategory = detail.job.job_category;
  const items = DEMO_PRIOR_INTELLIGENCE.filter((item) => {
    if (organizationId === "org-school" && item.id.startsWith("north-high")) {
      return true;
    }
    if (organizationId === "org-sports" && item.id.startsWith("metro-football")) {
      return true;
    }
    if (jobCategory === "event" && title.includes("graduation")) {
      return item.kind === "graduation_stage";
    }
    if (detail.school_profile?.school_type === "graduation") {
      return item.kind === "graduation_stage";
    }
    return false;
  });

  return {
    items,
    emptyTitle: "No prior notes or resources are linked yet.",
    emptySummary: "When this job or organization repeats, parking notes, setup references, prior lessons, and production learnings will appear here."
  };
}

