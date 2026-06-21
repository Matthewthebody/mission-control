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
};

export type AtomicLocationInput = {
  location_name: string;
  address_line_1: string;
  address_line_2?: string | null;
  city: string;
  state: string;
  zip: string;
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
    await linkContactToOrganization(client, auth, contactId, organizationId, {
      relationship_role: contact.relationship_role,
      client_roles: contact.client_roles,
      is_primary: contact.is_primary
    });
  }

  // 5) Locations — new approved canonical locations under this organization.
  let createdLocationCount = 0;
  for (const location of input.locations ?? []) {
    await createOrganizationLocation(client, auth, organizationId, {
      location_name: location.location_name,
      address_line_1: location.address_line_1,
      address_line_2: location.address_line_2 ?? null,
      city: location.city,
      state: location.state,
      zip: location.zip,
      notes: location.notes ?? null
    });
    createdLocationCount += 1;
  }

  return {
    organization_id: organizationId,
    created_contact_ids: createdContactIds,
    linked_contact_ids: linkedContactIds,
    created_location_count: createdLocationCount
  };
}
