import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();
const testStamp = Date.now();

let schoolsToken = "";
let organizationId = "";
let secondaryOrganizationId = "";
let existingContactId = "";
let firstAmbiguousContactId = "";
let secondAmbiguousContactId = "";
let importSessionId = "";
let importedContactId = "";

describe("directory contact CSV import", () => {
  beforeAll(async () => {
    schoolsToken = (await devLogin(app, "schools-office@example.com")).body.token;

    const primaryOrganization = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        canonical_name: `Import Academy ${testStamp}`,
        display_name: `Import Academy ${testStamp}`,
        account_type: "schools_underclass_portraits",
        notes: "Primary organization for CSV contact import coverage."
      });

    expect(primaryOrganization.status).toBe(201);
    organizationId = primaryOrganization.body.organization.id;

    const secondaryOrganization = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        canonical_name: `Metro League ${testStamp}`,
        display_name: `Metro League ${testStamp}`,
        account_type: "sports",
        notes: "Secondary organization used for relationship history coverage."
      });

    expect(secondaryOrganization.status).toBe(201);
    secondaryOrganizationId = secondaryOrganization.body.organization.id;

    const existingContact = await request(app)
      .post(`/api/organizations/${organizationId}/contacts`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        first_name: "Jamie",
        last_name: `Carlson ${testStamp}`,
        title: "Activities Director",
        email: `jamie.import.${testStamp}@example.com`,
        phone: "555-0210",
        notes: "Existing contact for exact-email import linking."
      });

    expect(existingContact.status).toBe(201);
    existingContactId = existingContact.body.contacts.find(
      (contact: { full_name: string }) => contact.full_name === `Jamie Carlson ${testStamp}`
    ).id;

    const firstAmbiguousContact = await request(app)
      .post(`/api/organizations/${organizationId}/contacts`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        first_name: "Pat",
        last_name: `Morgan ${testStamp}`,
        phone: "555-7878",
        notes: "Ambiguous import candidate one."
      });

    expect(firstAmbiguousContact.status).toBe(201);
    firstAmbiguousContactId = firstAmbiguousContact.body.contacts.find(
      (contact: { full_name: string }) => contact.full_name === `Pat Morgan ${testStamp}`
    ).id;

    const secondAmbiguousContact = await request(app)
      .post(`/api/organizations/${secondaryOrganizationId}/contacts`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        first_name: "Pat",
        last_name: `Morgan ${testStamp}`,
        phone: "555-7878",
        notes: "Ambiguous import candidate two."
      });

    expect(secondAmbiguousContact.status).toBe(201);
    secondAmbiguousContactId = secondAmbiguousContact.body.contacts.find(
      (contact: { full_name: string }) => contact.full_name === `Pat Morgan ${testStamp}`
    ).id;
  });

  afterAll(async () => {
    if (importSessionId) {
      await pool.query("DELETE FROM directory_import_row WHERE session_id = $1", [importSessionId]);
      await pool.query("DELETE FROM directory_import_session WHERE id = $1", [importSessionId]);
    }
    if ([importedContactId, existingContactId, firstAmbiguousContactId, secondAmbiguousContactId].filter(Boolean).length) {
      await pool.query(
        "DELETE FROM organization_contact_relationship WHERE contact_id = ANY($1::uuid[])",
        [[importedContactId, existingContactId, firstAmbiguousContactId, secondAmbiguousContactId].filter(Boolean)]
      );
      await pool.query(
        "DELETE FROM organization_contact WHERE id = ANY($1::uuid[])",
        [[importedContactId, existingContactId, firstAmbiguousContactId, secondAmbiguousContactId].filter(Boolean)]
      );
    }
    if (organizationId) {
      await pool.query("DELETE FROM organization WHERE id = $1", [organizationId]);
    }
    if (secondaryOrganizationId) {
      await pool.query("DELETE FROM organization WHERE id = $1", [secondaryOrganizationId]);
    }
  });

  it("stages CSV rows safely, preserves duplicate candidates, and applies create/link decisions", async () => {
    const csv = [
      "first_name,last_name,email,phone,organization_name,relationship_role,start_date,end_date,current_flag,notes",
      `Taylor,Rowe,taylor.import.${testStamp}@example.com,555-1000,Import Academy ${testStamp},planning,2026-01-05,,yes,New planning contact`,
      `Jamie,Carlson ${testStamp},jamie.import.${testStamp}@example.com,555-0210,Import Academy ${testStamp},billing,2026-02-01,,yes,Existing contact should link`,
      `Jamie,Carlson ${testStamp},jamie.import.${testStamp}@example.com,555-0210,Metro League ${testStamp},operations,2024-08-01,2025-02-01,no,Previous league relationship`,
      `Pat,Morgan ${testStamp},,555-7878,,general,,,yes,Ambiguous row`
    ].join("\n");

    const sessionResponse = await request(app)
      .post("/api/organizations/contact-import-sessions")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        source_file_name: `contacts-${testStamp}.csv`,
        csv_text: csv
      });

    expect(sessionResponse.status).toBe(201);
    importSessionId = sessionResponse.body.id;
    expect(sessionResponse.body.summary).toEqual(
      expect.objectContaining({
        total_rows: 4,
        ready_to_create: 1,
        ready_to_link: 2,
        needs_review: 1
      })
    );

    const rowOne = sessionResponse.body.rows.find((row: { row_number: number }) => row.row_number === 1);
    const rowTwo = sessionResponse.body.rows.find((row: { row_number: number }) => row.row_number === 2);
    const rowThree = sessionResponse.body.rows.find((row: { row_number: number }) => row.row_number === 3);
    const rowFour = sessionResponse.body.rows.find((row: { row_number: number }) => row.row_number === 4);

    expect(rowOne.proposed_action).toBe("create_contact");
    expect(rowTwo.proposed_action).toBe("link_existing");
    expect(rowTwo.candidate_matches).toHaveLength(1);
    expect(rowTwo.candidate_matches[0].reason).toBe("Exact email match");
    expect(rowThree.normalized_values.is_current).toBe(false);
    expect(rowFour.status).toBe("needs_review");
    expect(rowFour.candidate_matches).toHaveLength(2);

    const listSessionsResponse = await request(app)
      .get("/api/organizations/contact-import-sessions")
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(listSessionsResponse.status).toBe(200);
    expect(listSessionsResponse.body.total).toBeGreaterThanOrEqual(1);
    expect(
      listSessionsResponse.body.sessions.some(
        (session: { id: string; source_file_name: string; summary: { total_rows: number } }) =>
          session.id === importSessionId &&
          session.source_file_name === `contacts-${testStamp}.csv` &&
          session.summary.total_rows === 4
      )
    ).toBe(true);

    const skipAmbiguousRow = await request(app)
      .patch(`/api/organizations/contact-import-sessions/${importSessionId}/rows/${rowFour.id}`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        selected_action: "skip",
        review_note: "Skipping ambiguous row until a human confirms which Pat Morgan should be linked."
      });

    expect(skipAmbiguousRow.status).toBe(200);
    expect(
      skipAmbiguousRow.body.rows.find((row: { id: string; status: string }) => row.id === rowFour.id)?.status
    ).toBe("skipped");

    const applyResponse = await request(app)
      .post(`/api/organizations/contact-import-sessions/${importSessionId}/apply`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({});

    expect(applyResponse.status).toBe(200);
    expect(applyResponse.body.status).toBe("applied");
    expect(applyResponse.body.summary).toEqual(
      expect.objectContaining({
        applied: 3,
        skipped: 1,
        ready_to_create: 0,
        ready_to_link: 0
      })
    );

    const appliedCreateRow = applyResponse.body.rows.find(
      (row: { row_number: number; status: string }) => row.row_number === 1 && row.status === "applied"
    );
    const appliedHistoricalRow = applyResponse.body.rows.find(
      (row: { row_number: number; status: string }) => row.row_number === 3 && row.status === "applied"
    );

    importedContactId = appliedCreateRow.applied_contact_id;
    expect(importedContactId).toBeTruthy();
    expect(appliedHistoricalRow.applied_contact_id).toBe(existingContactId);

    const importedCountResult = await pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM organization_contact
        WHERE email = $1
      `,
      [`jamie.import.${testStamp}@example.com`]
    );
    expect(Number(importedCountResult.rows[0].count)).toBe(1);

    const contactDetail = await request(app)
      .get(`/api/organizations/contacts/${existingContactId}`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(contactDetail.status).toBe(200);
    expect(
      contactDetail.body.contact.relationship_history.some(
        (relationship: { organization_id: string; relationship_state: string; end_date: string }) =>
          relationship.organization_id === secondaryOrganizationId &&
          relationship.relationship_state === "previous" &&
          relationship.end_date === "2025-02-01"
      )
    ).toBe(true);

    const secondaryOrganizationDetail = await request(app)
      .get(`/api/organizations/${secondaryOrganizationId}`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(secondaryOrganizationDetail.status).toBe(200);
    expect(
      secondaryOrganizationDetail.body.contacts.every((contact: { id: string }) => contact.id !== existingContactId)
    ).toBe(true);
  });
});
