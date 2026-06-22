// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCompanyCommandCards } from "../home/homeDemoData";
import { resolveActionTarget } from "../home/actionTargets";

// June 18 — lock the cross-surface action audit artifact to the LIVE action contract. If a card's
// destination or availability changes, this fails so the audit can never silently go stale.
// cwd is packages/admin-web during the admin-web vitest run → repo root is two levels up.
const auditPath = resolve(process.cwd(), "../../docs/artifacts/june18-action-and-runtime-audit.json");
const audit = JSON.parse(readFileSync(auditPath, "utf8"));

function cardDestination(id: string) {
  const card = buildCompanyCommandCards().find((c) => c.id === id);
  if (!card) throw new Error(`card ${id} not found`);
  return resolveActionTarget(card.target);
}
function auditControl(label: string) {
  const cc = audit.surfaces.find((s: any) => s.surface === "Company Command");
  return cc.controls.find((c: any) => c.label === label);
}

describe("June 18 action audit artifact matches the live contract", () => {
  it("the artifact JSON is valid and summarizes the fixes", () => {
    expect(audit.artifact).toBe("june18-action-and-runtime-audit");
    expect(audit.summary.deterministic_defects_fixed).toBe(audit.summary.deterministic_defects_found);
    expect(audit.summary.dead_enabled_controls).toBe(0);
  });

  it("Production Load resolves to the canonical Production blocked view — matching the audit", () => {
    const resolved = cardDestination("production-load");
    expect(resolved.available).toBe(true);
    expect((resolved as { hash: string }).hash).toBe("#production/operations?stage=blocked");
    expect(auditControl("Production Load").destination).toBe("#production/operations?stage=blocked");
    expect(auditControl("Production Load").correction_commit).toBe("0f683ff");
  });

  it("On Fire and Jobs Behind resolve to the audited destinations", () => {
    expect((cardDestination("on-fire") as { hash: string }).hash).toBe("#urgent-window?status=open");
    expect(auditControl("On Fire").destination).toBe("#urgent-window?status=open");
    expect((cardDestination("jobs-behind") as { hash: string }).hash).toBe("#jobs?readinessStatus=off_track");
    expect(auditControl("Jobs Behind").destination).toBe("#jobs?readinessStatus=off_track");
  });

  it("Weather and Client Issues are unavailable in both the contract and the audit (no dead enabled control)", () => {
    expect(cardDestination("weather-watch").available).toBe(false);
    expect(cardDestination("client-issues").available).toBe(false);
    expect(auditControl("Weather").state).toBe("disabled");
    expect(auditControl("Client Issues").state).toBe("disabled");
  });
});
