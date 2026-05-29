import type { GlossaryEntry } from "./types.js";

const ALL_LAYERS = [
  "database_schema",
  "backend_types",
  "api_contracts",
  "frontend_ui",
  "filters_and_dashboards",
  "audit_logs",
  "permissions",
  "alerts_and_notifications",
  "integrations",
  "prompts_and_docs"
] as const;

const OPERATIONAL_LAYERS = [
  "backend_types",
  "api_contracts",
  "frontend_ui",
  "filters_and_dashboards",
  "audit_logs",
  "permissions",
  "alerts_and_notifications",
  "integrations",
  "prompts_and_docs"
] as const;

export const LOCKED_GLOSSARY: GlossaryEntry[] = [
  {
    canonicalTerm: "Organization",
    category: "core_object",
    plainEnglishDefinition:
      "The canonical client/account record that owns client identity, contacts, locations, shoots, agreements, and related operational history.",
    usedIn: ALL_LAYERS,
    whatItIsNot: "It is not a Contact, Location, Shoot, or auth account.",
    allowedSynonyms: ["Account", "Client Account"],
    discouragedSynonyms: ["Client", "Customer", "School"]
  },
  {
    canonicalTerm: "Contact",
    category: "core_object",
    plainEnglishDefinition:
      "A person record linked to one Organization and used for scheduling, communication, agreements, and recurring relationship context.",
    usedIn: ALL_LAYERS,
    whatItIsNot: "It is not an Employee or a freeform name string.",
    allowedSynonyms: ["Primary Contact"],
    discouragedSynonyms: ["Person", "Admin", "Lead"]
  },
  {
    canonicalTerm: "School Contact",
    category: "core_object",
    plainEnglishDefinition:
      "A Contact record used in the context of a school Organization, usually representing scheduling, administrative, or on-site coordination.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not a separate root entity from Contact and not an internal Employee role.",
    allowedSynonyms: ["School Coordinator"],
    discouragedSynonyms: ["School Admin", "Admin"]
  },
  {
    canonicalTerm: "Shoot",
    category: "core_object",
    plainEnglishDefinition:
      "The primary operational execution record for a photography engagement at a specific Organization and usually a specific Location.",
    usedIn: ALL_LAYERS,
    whatItIsNot: "It is not a Shift, not an Assignment, and not a generic job ticket.",
    allowedSynonyms: ["Photo Day"],
    discouragedSynonyms: ["Job", "Event"]
  },
  {
    canonicalTerm: "Shift",
    category: "core_object",
    plainEnglishDefinition:
      "A scheduled work block for one Employee that may be linked to a Shoot, office work, studio work, or training.",
    usedIn: ALL_LAYERS,
    whatItIsNot: "It is not the Shoot itself and not the staffing Assignment inside the Shoot.",
    allowedSynonyms: ["Work Shift"],
    discouragedSynonyms: ["Job", "Gig"]
  },
  {
    canonicalTerm: "Assignment",
    category: "core_object",
    plainEnglishDefinition:
      "A staffing record that links an Employee to a Shoot role, coverage need, or operational responsibility.",
    usedIn: ALL_LAYERS,
    whatItIsNot: "It is not general availability, not the full Shift record, and not attendance proof.",
    allowedSynonyms: ["Staff Assignment"],
    discouragedSynonyms: ["Booking", "Slot"]
  },
  {
    canonicalTerm: "Employee",
    category: "core_object",
    plainEnglishDefinition:
      "An internal worker with system membership who can be scheduled, assigned, authorized, clocked, reviewed, and audited.",
    usedIn: ALL_LAYERS,
    whatItIsNot: "It is not a Contact or an external client person.",
    allowedSynonyms: ["Team Member"],
    discouragedSynonyms: ["User", "Staff"]
  },
  {
    canonicalTerm: "Location",
    category: "core_object",
    plainEnglishDefinition:
      "A physical place tied to an Organization where a Shoot can occur and where recurring operational intelligence can accumulate.",
    usedIn: ALL_LAYERS,
    whatItIsNot: "It is not the Organization record and not a freeform venue string when a canonical record exists.",
    allowedSynonyms: ["Site", "Campus Location"],
    discouragedSynonyms: ["Building", "Venue"]
  },
  {
    canonicalTerm: "Equipment",
    category: "core_object",
    plainEnglishDefinition:
      "The umbrella operational term for trackable photography gear used in field and office workflows.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not a single Asset by default and not always a Kit.",
    allowedSynonyms: ["Gear"],
    discouragedSynonyms: ["Stuff", "Item", "Kit"]
  },
  {
    canonicalTerm: "Asset",
    category: "core_object",
    plainEnglishDefinition:
      "An individually tracked piece of Equipment with its own identity, status, custody history, and service history.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not the same as a Kit and not a generic equipment category.",
    allowedSynonyms: ["Equipment Asset"],
    discouragedSynonyms: ["Gear Item"]
  },
  {
    canonicalTerm: "Kit",
    category: "core_object",
    plainEnglishDefinition:
      "A self-contained grouping of Assets that is assigned, checked out, verified, and returned as one operational unit.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not the identity of the Assets inside it and not a generic synonym for Equipment.",
    allowedSynonyms: ["Gear Kit"],
    discouragedSynonyms: ["Bag", "Case"]
  },
  {
    canonicalTerm: "Operational Note",
    category: "core_object",
    plainEnglishDefinition:
      "A structured internal note captured for operations context, memory, or follow-through within a controlled workflow.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not chat, not a comment thread, and not an alert by itself.",
    allowedSynonyms: [],
    discouragedSynonyms: ["Note", "Comment", "Message"]
  },
  {
    canonicalTerm: "Pre-Service Note",
    category: "core_object",
    plainEnglishDefinition:
      "An Operational Note recorded before or during prep to preserve setup, access, or execution information for the current or future Shoot.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not the same as a Post-Shoot Evaluation and not a chat message.",
    allowedSynonyms: ["Prep Note"],
    discouragedSynonyms: ["Setup Note", "Field Comment"]
  },
  {
    canonicalTerm: "Setup Photo",
    category: "core_object",
    plainEnglishDefinition:
      "An operational image that shows on-site setup, readiness, or conditions needed for execution or future reference.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not a client-delivery image, not a generic upload, and not a Post-Shoot Evaluation.",
    allowedSynonyms: ["Prep Photo"],
    discouragedSynonyms: ["Reference Pic", "Upload"]
  },
  {
    canonicalTerm: "Post-Shoot Evaluation",
    category: "core_object",
    plainEnglishDefinition:
      "A structured closeout record tied to a Shoot that captures what went well, what to remember next time, and whether issues occurred.",
    usedIn: ALL_LAYERS,
    whatItIsNot: "It is not a freeform note, not an approval request, and not a Setup Photo.",
    allowedSynonyms: ["Closeout Evaluation"],
    discouragedSynonyms: ["Review", "Wrap Note"]
  },
  {
    canonicalTerm: "Issue",
    category: "core_object",
    plainEnglishDefinition:
      "A real operational problem or condition attached to an object or workflow that requires attention, tracking, or resolution.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not automatically an Alert, Exception, or Approval.",
    allowedSynonyms: [],
    discouragedSynonyms: ["Problem", "Bug", "Alert"]
  },
  {
    canonicalTerm: "Alert",
    category: "core_object",
    plainEnglishDefinition: "A system-generated signal that something needs attention, review, or escalation.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not the underlying Issue, not the delivery Notification, and not a review decision.",
    allowedSynonyms: ["Warning Signal"],
    discouragedSynonyms: ["Issue", "Notification", "Exception"]
  },
  {
    canonicalTerm: "Exception",
    category: "core_object",
    plainEnglishDefinition:
      "A deviation from expected operational or labor rules that requires explicit review, handling, or correction.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not a generic Issue and not the same as an Approval record.",
    allowedSynonyms: ["Exception Request"],
    discouragedSynonyms: ["Problem", "Alert", "Approval"]
  },
  {
    canonicalTerm: "Approval",
    category: "core_object",
    plainEnglishDefinition:
      "A controlled review workflow and decision record that authorizes or denies a requested action or exception outcome.",
    usedIn: ALL_LAYERS,
    whatItIsNot: "It is not a Permission, not the Exception itself, and not a Notification.",
    allowedSynonyms: ["Approval Request"],
    discouragedSynonyms: ["Decision", "Manager OK"]
  },
  {
    canonicalTerm: "Availability",
    category: "core_object",
    plainEnglishDefinition:
      "The declared or derived ability of an Employee to be assigned to work during a given time window.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not an Assignment, not attendance proof, and not final staffing publication.",
    allowedSynonyms: [],
    discouragedSynonyms: ["Free", "Open"]
  },
  {
    canonicalTerm: "Time Clock Entry",
    category: "core_object",
    plainEnglishDefinition:
      "The user-facing umbrella term for recorded labor-state history, backed by Time Session, Time Segment, and Clock Event records.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not a Shift, not a payroll export row, and not only a punch-in timestamp.",
    allowedSynonyms: ["Time Record"],
    discouragedSynonyms: ["Timesheet", "Punch", "Entry"]
  },
  {
    canonicalTerm: "Notification",
    category: "core_object",
    plainEnglishDefinition:
      "A delivered message to a person through channels like in-app, push, SMS, or email.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not the same as an Alert and not the underlying business record that caused it.",
    allowedSynonyms: [],
    discouragedSynonyms: ["Alert", "Message"]
  },
  {
    canonicalTerm: "Photographer",
    category: "actor",
    plainEnglishDefinition: "An Employee whose operational role includes field photography execution on Shoots.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not every Employee and not automatically the Lead Photographer.",
    allowedSynonyms: [],
    discouragedSynonyms: ["Shooter"]
  },
  {
    canonicalTerm: "Senior Photographer",
    category: "actor",
    plainEnglishDefinition:
      "A Photographer with elevated field experience, often trusted with more complex execution and mentoring expectations.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not automatically a Manager or the Lead Photographer on every Shoot.",
    allowedSynonyms: [],
    discouragedSynonyms: ["Senior Shooter"]
  },
  {
    canonicalTerm: "Lead Photographer",
    category: "actor",
    plainEnglishDefinition:
      "The Photographer responsible for on-site field leadership and execution ownership for a specific Shoot.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not a standing org title and not the same as Director of Photography.",
    allowedSynonyms: ["Shoot Lead"],
    discouragedSynonyms: ["Lead", "Owner"]
  },
  {
    canonicalTerm: "Director of Photography",
    category: "actor",
    plainEnglishDefinition:
      "A leadership role accountable for field photography standards, staffing confidence, and escalated operational oversight.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not the same as Lead Photographer and not a generic Admin.",
    allowedSynonyms: ["DOP"],
    discouragedSynonyms: ["Director", "Photo Lead"]
  },
  {
    canonicalTerm: "Manager",
    category: "actor",
    plainEnglishDefinition:
      "An internal operator role with responsibility for reviewing, adjusting, or overseeing operational workflows within allowed scope.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not equivalent to Leadership and not always an Approver for every workflow.",
    allowedSynonyms: ["Assistant Manager"],
    discouragedSynonyms: ["Admin", "Owner"]
  },
  {
    canonicalTerm: "Leadership",
    category: "actor",
    plainEnglishDefinition: "The high-authority operational and business oversight tier for the system.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not every Manager role and not just a UI label.",
    allowedSynonyms: ["Leadership Team"],
    discouragedSynonyms: ["Admin", "Executives"]
  },
  {
    canonicalTerm: "Scheduler",
    category: "actor",
    plainEnglishDefinition:
      "An internal role responsible for creating, shaping, or publishing staffing and scheduling decisions.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not automatically an Approver and not necessarily Leadership.",
    allowedSynonyms: [],
    discouragedSynonyms: ["Coordinator", "Planner"]
  },
  {
    canonicalTerm: "Reviewer",
    category: "actor",
    plainEnglishDefinition:
      "An actor allowed to inspect and evaluate a request, exception, or operational record before or without making the final decision.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not always the final Approver and not automatically Leadership.",
    allowedSynonyms: [],
    discouragedSynonyms: ["Approver", "Admin"]
  },
  {
    canonicalTerm: "Approver",
    category: "actor",
    plainEnglishDefinition:
      "An actor with authority to make a binding approve, reject, or return decision in an Approval workflow.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not the same as a generic Reviewer and not the Permission system itself.",
    allowedSynonyms: [],
    discouragedSynonyms: ["Reviewer", "Manager OK"]
  },
  {
    canonicalTerm: "Admin",
    category: "actor",
    plainEnglishDefinition: "A technical or high-authority administrative actor with system-level management capabilities.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not a generic synonym for Leadership, Manager, or Contact.",
    allowedSynonyms: ["System Admin"],
    discouragedSynonyms: ["Admin used for school/client contacts"]
  },
  {
    canonicalTerm: "Shoot Status",
    category: "state_concept",
    plainEnglishDefinition: "The lifecycle-owned state that describes where a Shoot is in its execution lifecycle.",
    usedIn: ALL_LAYERS,
    whatItIsNot: "It is not Readiness, not Assignment Status, and not Approval Status.",
    allowedSynonyms: [],
    discouragedSynonyms: ["Status", "State"]
  },
  {
    canonicalTerm: "Readiness",
    category: "state_concept",
    plainEnglishDefinition: "The subsystem that evaluates whether a Shoot is operationally prepared to proceed.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not the lifecycle engine, not staffing itself, and not an approval.",
    allowedSynonyms: [],
    discouragedSynonyms: ["Prep", "Go State"]
  },
  {
    canonicalTerm: "Readiness State",
    category: "state_concept",
    plainEnglishDefinition: "The discrete result label produced by the readiness engine for a Shoot at a point in time.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not Shoot Status and not a freeform badge label.",
    allowedSynonyms: [],
    discouragedSynonyms: ["Status", "Prep Status"]
  },
  {
    canonicalTerm: "Go / No-Go State",
    category: "state_concept",
    plainEnglishDefinition:
      "The operational decision state for whether a Shoot should proceed, pause, or require override attention.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not identical to Readiness State and not the same as Shoot Status.",
    allowedSynonyms: ["Go State"],
    discouragedSynonyms: ["Readiness", "Status"]
  },
  {
    canonicalTerm: "Alert Severity",
    category: "state_concept",
    plainEnglishDefinition:
      "The urgency classification applied to an Alert so operators understand how quickly attention is required.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not the same as Issue type and not a notification channel.",
    allowedSynonyms: ["Severity"],
    discouragedSynonyms: ["Priority", "Impact"]
  },
  {
    canonicalTerm: "Approval Status",
    category: "state_concept",
    plainEnglishDefinition:
      "The workflow state of an Approval request from submission through final decision and execution.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not the status of the underlying Shoot, Assignment, or Exception itself.",
    allowedSynonyms: [],
    discouragedSynonyms: ["Decision Status", "Review Status"]
  },
  {
    canonicalTerm: "Assignment Status",
    category: "state_concept",
    plainEnglishDefinition:
      "The staffing-owned state that describes whether an Assignment is drafted, active, changed, removed, or otherwise operationally valid.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not attendance proof, not Shoot Status, and not Readiness State.",
    allowedSynonyms: [],
    discouragedSynonyms: ["Staffing Status", "Shift Status"]
  },
  {
    canonicalTerm: "Attendance Status",
    category: "state_concept",
    plainEnglishDefinition:
      "The labor and presence state that describes whether an Employee has arrived, clocked, is late, missing, corrected, or resolved for a work expectation.",
    usedIn: OPERATIONAL_LAYERS,
    whatItIsNot: "It is not Assignment Status and not a payroll export state.",
    allowedSynonyms: [],
    discouragedSynonyms: ["Status", "Presence"]
  }
];
