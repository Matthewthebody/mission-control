import type { LegacySynonymMapping } from "./types.js";

export const LEGACY_SYNONYM_MAPPINGS: LegacySynonymMapping[] = [
  {
    legacyTerm: "Account",
    canonicalTerm: "Organization",
    guidance: "Allowed as UI/business shorthand, but it does not represent a separate root record."
  },
  {
    legacyTerm: "Client Account",
    canonicalTerm: "Organization",
    guidance: "Use where business context requires client language; keep schema and DTOs on Organization."
  },
  {
    legacyTerm: "Gear",
    canonicalTerm: "Equipment",
    guidance: "Fine for UI copy, but distinguish Asset and Kit when the record type matters."
  },
  {
    legacyTerm: "Job",
    canonicalTerm: "Shoot",
    guidance: "Use only when the actual meaning is Shoot; otherwise replace with Shift or Assignment."
  },
  {
    legacyTerm: "Work Order",
    canonicalTerm: "Shoot",
    guidance: "Do not introduce as a new root object for standard photography operations."
  },
  {
    legacyTerm: "Time Entry",
    canonicalTerm: "Time Clock Entry",
    guidance: "Use Time Clock Entry as the user-facing umbrella; use Time Session, Time Segment, and Clock Event in technical layers."
  },
  {
    legacyTerm: "Punch",
    canonicalTerm: "Time Clock Entry",
    guidance: "Only use when describing a specific clock-in or clock-out event, not a whole labor record."
  },
  {
    legacyTerm: "Prep Photo",
    canonicalTerm: "Setup Photo",
    guidance: "Allowed in UI copy, but Setup Photo remains the canonical object name."
  },
  {
    legacyTerm: "Closeout",
    canonicalTerm: "Post-Shoot Evaluation",
    guidance: "Use Closeout only as shorthand for the workflow, not as the canonical record name."
  },
  {
    legacyTerm: "Problem",
    canonicalTerm: "Issue",
    guidance: "Map to Issue only when the meaning is a tracked operational condition, not a generic warning."
  },
  {
    legacyTerm: "Warning",
    canonicalTerm: "Alert",
    guidance: "Use Alert for the actual system signal and Alert Severity for urgency."
  },
  {
    legacyTerm: "Review Request",
    canonicalTerm: "Approval",
    guidance: "Map to Approval when the workflow produces an approval-status record and decision."
  }
];
