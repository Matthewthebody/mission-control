export type RiskLevel = "low" | "medium" | "high";

export type IntegrationStatusCard = {
  system: string;
  status: "synced" | "mocked" | "attention";
  note: string;
};

export type SetupPhotoCard = {
  src: string;
  caption: string;
};

export type PastEvaluation = {
  season: string;
  score: string;
  note: string;
};

export type HistoricalNote = {
  title: string;
  note: string;
  createdAt: string;
};

export type ShootStudioContext = {
  preServiceInfo: string[];
  schoolRules: string[];
  setupPhotos: SetupPhotoCard[];
  pastEvaluations: PastEvaluation[];
  historicalNotes: HistoricalNote[];
  weatherRisk: {
    level: RiskLevel;
    summary: string;
  };
  travelRisk: {
    level: RiskLevel;
    summary: string;
  };
  supportNotes: string[];
  integrationStatus: IntegrationStatusCard[];
};

export type ManagerApprovalCard = {
  id: string;
  category: "hours_edit" | "shift_edit" | "pto" | "post_shoot_eval";
  priority: "normal" | "high" | "critical";
  requester: string;
  owner: string;
  title: string;
  detail: string;
  shootCode?: string | null;
  requiresReview: boolean;
};

type ShootLike = {
  shoot_code?: string | null;
  title?: string | null;
  location_name?: string | null;
};

const fallbackContext: ShootStudioContext = {
  preServiceInfo: [
    "Family greeting should happen at the north entrance ten minutes before arrival.",
    "Confirm any weather shift with leadership before moving setup indoors.",
    "Use the standard senior-session setup flow and confirm the hero location before unloading gear."
  ],
  schoolRules: [
    "Front office check-in is required before any setup begins.",
    "Keep hallway staging tidy and out of parent traffic paths."
  ],
  setupPhotos: [
    {
      src: "/demo/setup-studio.svg",
      caption: "Reference setup on file"
    }
  ],
  pastEvaluations: [
    {
      season: "Spring 2025",
      score: "Strong parent communication",
      note: "Families responded well when the lead photographer announced wait times up front."
    }
  ],
  historicalNotes: [
    {
      title: "Arrival buffer",
      note: "Parking and unload usually need an extra five to ten minutes during school release traffic.",
      createdAt: "2025-09-14"
    }
  ],
  weatherRisk: {
    level: "low",
    summary: "No active weather concern in the mocked Phase 1 studio feed."
  },
  travelRisk: {
    level: "low",
    summary: "Standard travel buffer is enough for the current mocked route."
  },
  supportNotes: [
    "No active client-service escalation is attached in the mocked support adapter."
  ],
  integrationStatus: [
    {
      system: "Outlook Calendar",
      status: "mocked",
      note: "Phase 1 mocked sync status. Mission Control remains the source of truth."
    },
    {
      system: "Monday Workboard",
      status: "mocked",
      note: "No live Monday connection in Phase 1. Operational requests are represented through the mocked queue."
    },
    {
      system: "Zendesk Service",
      status: "mocked",
      note: "No open service escalation in the mock adapter."
    },
    {
      system: "Geofence Review",
      status: "mocked",
      note: "GPS and geofence messaging are simulated through the Phase 1 location adapter."
    }
  ]
};

const contextByShootCode: Record<string, ShootStudioContext> = {
  "DEMO-001": {
    preServiceInfo: [
      "Senior session family prefers the lake-side setup first before moving to the tree line.",
      "Photographer should confirm cap-and-gown styling before first frame.",
      "Leadership asked for a warmer pacing update halfway through the session because grandparents may join late."
    ],
    schoolRules: [
      "Families can wait near the west lot, but no gear cases should block the walking path.",
      "Music stays low if the neighboring baseball practice is active."
    ],
    setupPhotos: [
      {
        src: "/demo/setup-demo-001-a.svg",
        caption: "Primary park setup reference"
      },
      {
        src: "/demo/setup-demo-001-b.svg",
        caption: "Backup tree-line composition"
      }
    ],
    pastEvaluations: [
      {
        season: "Fall 2025",
        score: "Excellent greeting and setup confidence",
        note: "Family specifically called out how calmly the team handled a late start."
      },
      {
        season: "Spring 2025",
        score: "Needs tighter wrap timing",
        note: "Unload and exit drifted long after final images wrapped."
      }
    ],
    historicalNotes: [
      {
        title: "Parking pattern",
        note: "Best unload path is the north lot because the south lane backs up during school dismissal.",
        createdAt: "2025-10-02"
      },
      {
        title: "Setup photo context",
        note: "Preferred backdrop is the stone wall after 4:30 PM when the light softens.",
        createdAt: "2025-08-11"
      }
    ],
    weatherRisk: {
      level: "medium",
      summary: "Mocked forecast suggests gusty wind near the lake edge after 5 PM."
    },
    travelRisk: {
      level: "medium",
      summary: "Mocked drive-time feed shows heavier than normal after-school traffic on the last five minutes in."
    },
    supportNotes: [
      "Family requested a reminder text if the photographer is more than ten minutes behind the arrival window.",
      "Keep the greeting warm and personal because this is a referral household."
    ],
    integrationStatus: [
      {
        system: "Outlook Calendar",
        status: "synced",
        note: "Mocked calendar event is marked in sync with the latest published shift."
      },
      {
        system: "Monday Workboard",
        status: "mocked",
        note: "Post-shoot follow-up task is staged in the mock workboard queue."
      },
      {
        system: "Zendesk Service",
        status: "attention",
        note: "Mocked service note says to double-check family arrival messaging."
      },
      {
        system: "Geofence Review",
        status: "mocked",
        note: "Default one-mile shoot radius is active in the location adapter."
      }
    ]
  },
  "DEMO-002": {
    preServiceInfo: [
      "Sports portrait day needs a faster cadence and tighter athlete flow than the senior-session playbook.",
      "Senior lead should confirm roster sequencing with the field coordinator before opening lanes.",
      "Flag any lighting changes quickly because the mock weather feed shows cloud movement around start time."
    ],
    schoolRules: [
      "Stay clear of team warmup lanes until the coach releases the athletes.",
      "No backdrop stands on the turf; use weighted sideline staging only."
    ],
    setupPhotos: [
      {
        src: "/demo/setup-demo-002-a.svg",
        caption: "Sideline portrait flow"
      },
      {
        src: "/demo/setup-demo-002-b.svg",
        caption: "Indoor backup gym setup"
      }
    ],
    pastEvaluations: [
      {
        season: "Winter 2025",
        score: "High student volume handled well",
        note: "Team kept athlete lines moving with strong coaching support."
      }
    ],
    historicalNotes: [
      {
        title: "Travel timing",
        note: "Last mile to the stadium can slow dramatically if youth traffic starts early.",
        createdAt: "2025-11-03"
      }
    ],
    weatherRisk: {
      level: "high",
      summary: "Mocked weather board shows a thunderstorm watch near the outdoor setup window."
    },
    travelRisk: {
      level: "medium",
      summary: "Mocked stadium traffic is elevated but still inside the planned buffer."
    },
    supportNotes: [
      "Coach wants a live heads-up if athlete pacing falls more than one rotation behind."
    ],
    integrationStatus: [
      {
        system: "Outlook Calendar",
        status: "attention",
        note: "Mocked calendar surface shows a pending travel-time update after the latest publish."
      },
      {
        system: "Monday Workboard",
        status: "mocked",
        note: "Crew checklist is staged in the mock workboard feed."
      },
      {
        system: "Zendesk Service",
        status: "mocked",
        note: "No open service case in the mock support queue."
      },
      {
        system: "Geofence Review",
        status: "mocked",
        note: "Default one-mile shoot radius is active for the stadium location."
      }
    ]
  }
};

const managerApprovals: ManagerApprovalCard[] = [
  {
    id: "hours-edit-demo-001",
    category: "hours_edit",
    priority: "high",
    requester: "Demo Senior Photographer",
    owner: "Leadership",
    title: "Approve labor adjustment for DEMO-001 wrap time",
    detail: "Senior lead logged a 20-minute wrap extension after family-requested outfit changes.",
    shootCode: "DEMO-001",
    requiresReview: true
  },
  {
    id: "shift-edit-demo-002",
    category: "shift_edit",
    priority: "critical",
    requester: "Demo Leadership",
    owner: "Admin",
    title: "Approve shift edit before DEMO-002 call time",
    detail: "Associate shift needs a 15-minute earlier arrival because of the mocked weather risk window.",
    shootCode: "DEMO-002",
    requiresReview: true
  },
  {
    id: "pto-review-office",
    category: "pto",
    priority: "normal",
    requester: "Demo Office Employee",
    owner: "Admin",
    title: "Review PTO request for studio office coverage",
    detail: "Two-day request overlaps the front-desk roster and needs a replacement plan.",
    requiresReview: false
  },
  {
    id: "post-shoot-eval-demo-001",
    category: "post_shoot_eval",
    priority: "normal",
    requester: "Demo Admin",
    owner: "Leadership",
    title: "Post-shoot evaluation ready for sign-off",
    detail: "Leadership note highlights strong family communication and one timing lesson for future staffing.",
    shootCode: "DEMO-001",
    requiresReview: false
  }
];

export const mockOutlookCalendarAdapter = {
  getSyncStatus(shootCode?: string | null) {
    return getShootContext(shootCode).integrationStatus.find((item) => item.system === "Outlook Calendar") ?? fallbackContext.integrationStatus[0];
  }
};

export const mockMondayWorkboardAdapter = {
  listManagerApprovals() {
    return managerApprovals.filter((request) => request.category === "hours_edit" || request.category === "shift_edit");
  }
};

export const mockZendeskServiceAdapter = {
  getSupportNotes(shootCode?: string | null) {
    return getShootContext(shootCode).supportNotes;
  }
};

export const mockGeofenceExperienceAdapter = {
  getRiskSnapshot(shootCode?: string | null) {
    const context = getShootContext(shootCode);
    return {
      weatherRisk: context.weatherRisk,
      travelRisk: context.travelRisk
    };
  }
};

export function getShootContext(shootCode?: string | null): ShootStudioContext {
  if (!shootCode) {
    return fallbackContext;
  }
  return contextByShootCode[shootCode] ?? fallbackContext;
}

export function listMockManagerApprovals() {
  return managerApprovals;
}

export function getStatusBoardTags(shoot: ShootLike) {
  const context = getShootContext(shoot.shoot_code);
  const tags = [
    {
      label: context.weatherRisk.summary,
      tone: context.weatherRisk.level
    },
    {
      label: context.travelRisk.summary,
      tone: context.travelRisk.level
    }
  ];
  return tags;
}
