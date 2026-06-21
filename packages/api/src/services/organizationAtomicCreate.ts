import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";
import { ApiError } from "../errors/apiError.js";
import { createOrganization, createOrganizationLocation, type CreateOrganizationInput } from "./organizations.js";
import { updateOrganizationBrand, type OrganizationBrandPatch } from "./organizationBrand.js";
import { createCanonicalContact, linkContactToOrganization } from "./canonicalContacts.js";
import { createSchoolServiceTerm } from "./schoolServiceTerm.js";

// ── Atomic canonical Create Organization (Phase 4.2 Part 3) ──────────────────
// ONE transaction-backed orchestration: organization + brand + optional first service term +
// N contact relationships (existing canonical identity OR inline new identity) + N new
// locations. Because the caller runs this inside a single withClientTransaction, any failure
// — a duplicate name, a bad contact, a bad location — rolls the WHOLE thing back: no partial
// organization, no orphan contact/identity/relationship, no orphan location, no partial brand
// or term. Replaces the old fragile sequence of independent HTTP calls. Never merges; an
// existing contact is linked by its canonical id only (no fuzzy match).

export type AtomicContactInput = {
  existing_contact_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  relationship_role?: string;
  client_roles?: string[];
  is_primary?: boolean;
  // Per-organization contextual relationship fields (set on the org-bound row, NOT the person).
  title?: string | null;
  notes?: string | null;
};

export type AtomicLocationInput = {
  // Either reuse an existing tenant Location (its canonical address is copied to this org —
  // locations are org-bound, so reuse copies the address rather than re-parenting another org's
  // row) OR create a new one inline. Room/access phrases (gym, auditorium) belong in notes.
  existing_location_id?: string | null;
  location_name?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  notes?: string | null;
  is_primary?: boolean;
};

export type AtomicInitialServiceTermInput = {
  period_type?: "school_year" | "season" | "custom";
  period_label: string;
  start_date?: string | null;
  end_date?: string | null;
};

export type AtomicCreateOrganizationInput = {
  organization: CreateOrganizationInput;
  contacts?: AtomicContactInput[];
  locations?: AtomicLocationInput[];
  brand?: OrganizationBrandPatch | null;
  initial_service_term?: AtomicInitialServiceTermInput | null;
};

export type AtomicCreateOrganizationResult = {
  organization_id: string;
  created_contact_ids: string[];
  linked_contact_ids: string[];
  created_location_count: number;
  primary_location_id: string | null;
};

export async function createOrganizationAtomic(
  client: PoolClient,
  auth: AuthUser,
  input: AtomicCreateOrganizationInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
): Promise<AtomicCreateOrganizationResult> {
  // 1) Organization (enforces School→parent-District + exact duplicate guard from createOrganization).
  const created = await createOrganization(client, auth, input.organization, meta);
  const organizationId = (created as { organization: { id: string } }).organization.id;

  // 2) Brand → canonical columns (never the notes blob).
  if (input.brand && Object.keys(input.brand).length) {
    await updateOrganizationBrand(client, auth, organizationId, input.brand);
  }

  // 3) Optional first service term.
  if (input.initial_service_term?.period_label?.trim()) {
    await createSchoolServiceTerm(client, auth, organizationId, {
      period_type: input.initial_service_term.period_type,
      period_label: input.initial_service_term.period_label,
      start_date: input.initial_service_term.start_date ?? null,
      end_date: input.initial_service_term.end_date ?? null
    });
  }

  // 4) Contacts — existing canonical identity (by id) or a new inline identity, then link
  //    each to this organization with its contextual role. No fuzzy matching, no merge.
  const createdContactIds: string[] = [];
  const linkedContactIds: string[] = [];
  for (const contact of input.contacts ?? []) {
    let contactId = contact.existing_contact_id?.trim() || null;
    if (!contactId) {
      const hasIdentity = Boolean((contact.first_name ?? "").trim() || (contact.last_name ?? "").trim() || (contact.full_name ?? "").trim() || (contact.email ?? "").trim());
      if (!hasIdentity) {
        throw new ApiError(400, "Each new contact needs at least a name or an email.");
      }
      const identity = await createCanonicalContact(client, auth, {
        first_name: contact.first_name ?? null,
        last_name: contact.last_name ?? null,
        full_name: contact.full_name ?? null,
        email: contact.email ?? null,
        phone: contact.phone ?? null
      });
      contactId = identity.id;
      createdContactIds.push(identity.id);
    } else {
      linkedContactIds.push(contactId);
    }
    const link = await linkContactToOrganization(client, auth, contactId, organizationId, {
      relationship_role: contact.relationship_role,
      client_roles: contact.client_roles,
      is_primary: contact.is_primary
    });
    // Per-organization contextual title/notes live on the org-bound row (not the person identity).
    if (contact.title != null || contact.notes != null) {
      await client.query(
        `UPDATE organization_contact
            SET title = CASE WHEN $3::boolean THEN $4 ELSE title END,
                notes = CASE WHEN $5::boolean THEN $6 ELSE notes END,
                updated_by_user_id = $7, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [auth.tenantId, link.organization_contact_id, contact.title != null, contact.title ?? null, contact.notes != null, contact.notes ?? null, auth.id]
      );
    }
  }

  // 5) Locations — reuse an existing tenant Location's canonical address or create a new one;
  //    one may be designated the organization's primary location. Room/access phrases stay in notes.
  let createdLocationCount = 0;
  let primaryLocationId: string | null = null;
  for (const location of input.locations ?? []) {
    let name = (location.location_name ?? "").trim();
    let line1 = (location.address_line_1 ?? "").trim();
    let line2 = location.address_line_2 ?? null;
    let city = (location.city ?? "").trim();
    let state = (location.state ?? "").trim();
    let zip = (location.zip ?? "").trim();
    let notes = location.notes ?? null;
    if (location.existing_location_id?.trim()) {
      const src = (
        await client.query<{ name: string; address_line_1: string | null; address_line_2: string | null; city: string | null; state: string | null; zip: string | null; location_details: string | null }>(
          `SELECT name, address_line_1, address_line_2, city, state, zip, location_details FROM shoot_location WHERE tenant_id = $1 AND id = $2`,
          [auth.tenantId, location.existing_location_id.trim()]
        )
      ).rows[0];
      if (!src) throw new ApiError(400, "Selected Location was not found in this tenant.");
      // Locations are org-bound: reuse copies the canonical address into this org's own row.
      name = src.name;
      line1 = src.address_line_1 ?? "";
      line2 = src.address_line_2;
      city = src.city ?? "";
      state = src.state ?? "";
      zip = src.zip ?? "";
      notes = notes ?? src.location_details;
    }
    if (!name || !line1) {
      throw new ApiError(400, "Each location needs a name and a street address (or an existing Location).");
    }
    await createOrganizationLocation(client, auth, organizationId, {
      location_name: name,
      address_line_1: line1,
      address_line_2: line2,
      city,
      state,
      zip,
      notes
    });
    createdLocationCount += 1;
    if (location.is_primary) {
      const newLoc = (
        await client.query<{ id: string }>(
          `SELECT id::text FROM shoot_location WHERE tenant_id = $1 AND organization_id = $2 AND name = $3 ORDER BY created_at DESC LIMIT 1`,
          [auth.tenantId, organizationId, name]
        )
      ).rows[0];
      if (newLoc) primaryLocationId = newLoc.id;
    }
  }
  if (primaryLocationId) {
    await client.query(
      `UPDATE organization SET primary_location_id = $3, updated_by_user_id = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [auth.tenantId, organizationId, primaryLocationId, auth.id]
    );
  }

  return {
    organization_id: organizationId,
    created_contact_ids: createdContactIds,
    linked_contact_ids: linkedContactIds,
    created_location_count: createdLocationCount,
    primary_location_id: primaryLocationId
  };
}
