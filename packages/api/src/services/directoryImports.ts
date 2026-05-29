import type { PoolClient } from "pg";
import { canManageCanonicalDirectoryRecords } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  DirectoryActiveStatus,
  DirectoryContactRelationshipRole,
  DirectoryImportCandidateMatch,
  DirectoryImportColumnKey,
  DirectoryImportColumnMapping,
  DirectoryImportRowAction,
  DirectoryImportRowRecord,
  DirectoryImportRowStatus,
  DirectoryImportSessionListItem,
  DirectoryImportSessionListResponse,
  DirectoryImportSessionRecord,
  DirectoryImportSessionStatus,
  DirectoryImportSessionSummary,
  OrganizationAccountType
} from "../types/organizations.js";
import { createAuditLog } from "./audit.js";

type CreateContactImportSessionInput = {
  source_file_name: string;
  csv_text: string;
  has_header_row?: boolean;
  default_organization_id?: string | null;
  column_mapping?: DirectoryImportColumnMapping;
};

type UpdateContactImportRowInput = {
  selected_action?: DirectoryImportRowAction | null;
  selected_contact_id?: string | null;
  resolved_organization_id?: string | null;
  review_note?: string | null;
};

type ApplyContactImportSessionInput = {
  rows?: Array<{
    row_id: string;
    selected_action?: DirectoryImportRowAction | null;
    selected_contact_id?: string | null;
    resolved_organization_id?: string | null;
    review_note?: string | null;
  }>;
};

type ImportSessionRow = {
  id: string;
  source_file_name: string;
  import_kind: string;
  status: DirectoryImportSessionStatus;
  has_header_row: boolean;
  default_organization_id: string | null;
  mapping: unknown;
  summary: unknown;
  created_by_user_id: string | null;
  applied_by_user_id: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
};

type ImportRowDb = {
  id: string;
  row_number: number;
  status: DirectoryImportRowStatus;
  proposed_action: DirectoryImportRowAction;
  selected_action: DirectoryImportRowAction | null;
  selected_contact_id: string | null;
  resolved_organization_id: string | null;
  raw_values: unknown;
  normalized_values: unknown;
  validation_errors: unknown;
  warning_messages: unknown;
  candidate_matches: unknown;
  review_note: string | null;
  applied_contact_id: string | null;
  applied_relationship_id: string | null;
  result_summary: string | null;
};

type OrganizationLookupRow = {
  id: string;
  display_name: string;
  account_type: OrganizationAccountType;
};

type ImportContactCandidateRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  current_organization_labels: unknown;
};

type NormalizedImportRow = {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  organization_name: string | null;
  organization_type: OrganizationAccountType | null;
  relationship_role: DirectoryContactRelationshipRole | null;
  notes: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  active_status: DirectoryActiveStatus;
  resolved_organization_id: string | null;
  resolved_organization_name: string | null;
};

type PreparedImportRow = {
  row_number: number;
  raw_values: Record<string, string | null>;
  normalized_values: NormalizedImportRow;
  validation_errors: string[];
  warning_messages: string[];
  candidate_matches: DirectoryImportCandidateMatch[];
  proposed_action: DirectoryImportRowAction;
  selected_action: DirectoryImportRowAction | null;
  selected_contact_id: string | null;
  status: DirectoryImportRowStatus;
  review_note: string | null;
};

const IMPORT_COLUMN_KEYS: DirectoryImportColumnKey[] = [
  "first_name",
  "last_name",
  "preferred_name",
  "title",
  "email",
  "phone",
  "organization_name",
  "organization_type",
  "relationship_role",
  "notes",
  "start_date",
  "end_date",
  "current_flag"
];

const IMPORT_COLUMN_ALIASES: Record<DirectoryImportColumnKey, string[]> = {
  first_name: ["first_name", "first name", "firstname", "given_name", "given name"],
  last_name: ["last_name", "last name", "lastname", "surname", "family_name", "family name"],
  preferred_name: ["preferred_name", "preferred name", "nickname", "preferred"],
  title: ["title", "job title", "position", "role"],
  email: ["email", "email_address", "email address"],
  phone: ["phone", "phone_number", "phone number", "mobile", "cell", "cell phone"],
  organization_name: [
    "organization",
    "organization_name",
    "organization name",
    "school",
    "school name",
    "district",
    "district name",
    "league",
    "league name",
    "company",
    "account"
  ],
  organization_type: ["organization_type", "organization type", "org type", "account_type", "account type", "type"],
  relationship_role: ["relationship_role", "relationship role", "contact role", "role type"],
  notes: ["notes", "note", "relationship notes", "team notes"],
  start_date: ["start_date", "start date", "relationship start", "joined"],
  end_date: ["end_date", "end date", "relationship end", "left", "departed"],
  current_flag: ["current", "current flag", "is current", "active", "current/active"]
};

export async function createContactImportSession(
  client: PoolClient,
  auth: AuthUser,
  input: CreateContactImportSessionInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
): Promise<DirectoryImportSessionRecord> {
  assertDirectoryManageAccess(auth);
  const sourceFileName = normalizeRequiredText(input.source_file_name, "Provide a CSV file name.");
  const csvText = input.csv_text?.trim();
  if (!csvText) {
    throw new ApiError(400, "Provide CSV content to start the import review.");
  }
  if (input.has_header_row === false) {
    throw new ApiError(400, "Contact CSV imports currently require a header row.");
  }
  if (input.default_organization_id) {
    await assertOrganizationExists(client, auth.tenantId, input.default_organization_id);
  }

  const parsedCsv = parseCsv(csvText);
  if (!parsedCsv.headers.length) {
    throw new ApiError(400, "The CSV header row could not be parsed.");
  }
  if (!parsedCsv.rows.length) {
    throw new ApiError(400, "The CSV file does not contain any contact rows.");
  }

  const mapping = resolveImportColumnMapping(parsedCsv.headers, input.column_mapping ?? {});
  if (!mapping.first_name && !mapping.last_name) {
    throw new ApiError(400, "Map at least first_name and last_name before importing contacts.");
  }

  const sessionInsert = await client.query<{ id: string }>(
    `
      INSERT INTO directory_import_session (
        tenant_id,
        source_file_name,
        import_kind,
        status,
        has_header_row,
        default_organization_id,
        mapping,
        summary,
        created_by_user_id
      )
      VALUES ($1,$2,'contacts_csv','staged',true,$3,$4::jsonb,$5::jsonb,$6)
      RETURNING id
    `,
    [auth.tenantId, sourceFileName, input.default_organization_id ?? null, JSON.stringify(mapping), JSON.stringify({}), auth.id]
  );
  const sessionId = sessionInsert.rows[0].id;

  for (let index = 0; index < parsedCsv.rows.length; index += 1) {
    const prepared = await prepareImportRow(client, auth, {
      rowNumber: index + 1,
      headers: parsedCsv.headers,
      values: parsedCsv.rows[index],
      mapping,
      defaultOrganizationId: input.default_organization_id ?? null
    });
    await client.query(
      `
        INSERT INTO directory_import_row (
          tenant_id,
          session_id,
          row_number,
          status,
          proposed_action,
          selected_action,
          selected_contact_id,
          resolved_organization_id,
          raw_values,
          normalized_values,
          validation_errors,
          warning_messages,
          candidate_matches,
          review_note
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14)
      `,
      [
        auth.tenantId,
        sessionId,
        prepared.row_number,
        prepared.status,
        prepared.proposed_action,
        prepared.selected_action,
        prepared.selected_contact_id,
        prepared.normalized_values.resolved_organization_id,
        JSON.stringify(prepared.raw_values),
        JSON.stringify(prepared.normalized_values),
        JSON.stringify(prepared.validation_errors),
        JSON.stringify(prepared.warning_messages),
        JSON.stringify(prepared.candidate_matches),
        prepared.review_note
      ]
    );
  }

  await refreshImportSessionSummary(client, auth.tenantId, sessionId);

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "directory.contact_import_session_created",
    entityType: "directory_import_session",
    entityId: sessionId,
    metadata: {
      source_file_name: sourceFileName,
      default_organization_id: input.default_organization_id ?? null,
      row_count: parsedCsv.rows.length
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return getContactImportSession(client, auth, sessionId);
}

export async function getContactImportSession(
  client: PoolClient,
  auth: AuthUser,
  sessionId: string
): Promise<DirectoryImportSessionRecord> {
  assertDirectoryManageAccess(auth);
  const session = await loadImportSession(client, auth.tenantId, sessionId);
  if (!session) {
    throw new ApiError(404, "Import session not found");
  }
  const rows = await loadImportRows(client, auth.tenantId, sessionId);
  return mapImportSession(session, rows);
}

export async function listContactImportSessions(
  client: PoolClient,
  auth: AuthUser
): Promise<DirectoryImportSessionListResponse> {
  assertDirectoryManageAccess(auth);
  const { rows } = await client.query<ImportSessionRow>(
    `
      SELECT
        id,
        source_file_name,
        import_kind,
        status,
        has_header_row,
        default_organization_id,
        mapping,
        summary,
        created_by_user_id,
        applied_by_user_id,
        applied_at::text,
        created_at::text,
        updated_at::text
      FROM directory_import_session
      WHERE tenant_id = $1
        AND import_kind = 'contacts_csv'
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 15
    `,
    [auth.tenantId]
  );
  return {
    sessions: rows.map(mapImportSessionListItem),
    total: rows.length
  };
}

export async function updateContactImportRow(
  client: PoolClient,
  auth: AuthUser,
  sessionId: string,
  rowId: string,
  input: UpdateContactImportRowInput
): Promise<DirectoryImportSessionRecord> {
  assertDirectoryManageAccess(auth);
  await assertImportSessionExists(client, auth.tenantId, sessionId);
  const row = await loadImportRow(client, auth.tenantId, sessionId, rowId);
  if (!row) {
    throw new ApiError(404, "Import row not found");
  }

  const nextSelectedAction =
    input.selected_action === undefined ? row.selected_action : input.selected_action;
  const nextSelectedContactId =
    input.selected_contact_id === undefined ? row.selected_contact_id : input.selected_contact_id;
  const nextOrganizationId =
    input.resolved_organization_id === undefined ? row.resolved_organization_id : input.resolved_organization_id;
  const nextReviewNote = input.review_note === undefined ? row.review_note : normalizeOptionalText(input.review_note);

  if (nextOrganizationId) {
    await assertOrganizationExists(client, auth.tenantId, nextOrganizationId);
  }
  if (nextSelectedContactId) {
    await assertContactExists(client, auth.tenantId, nextSelectedContactId);
  }

  const nextStatus = deriveImportRowStatus({
    validationErrors: toStringArray(row.validation_errors),
    candidateMatches: toCandidateMatches(row.candidate_matches),
    selectedAction: nextSelectedAction,
    selectedContactId: nextSelectedContactId,
    resolvedOrganizationId: nextOrganizationId,
    reviewNote: nextReviewNote
  });

  await client.query(
    `
      UPDATE directory_import_row
      SET
        selected_action = $4,
        selected_contact_id = $5,
        resolved_organization_id = $6,
        review_note = $7,
        status = $8,
        updated_at = now()
      WHERE tenant_id = $1
        AND session_id = $2
        AND id = $3
    `,
    [
      auth.tenantId,
      sessionId,
      rowId,
      nextSelectedAction,
      nextSelectedContactId,
      nextOrganizationId,
      nextReviewNote,
      nextStatus
    ]
  );

  await refreshImportSessionSummary(client, auth.tenantId, sessionId);
  return getContactImportSession(client, auth, sessionId);
}

export async function applyContactImportSession(
  client: PoolClient,
  auth: AuthUser,
  sessionId: string,
  input: ApplyContactImportSessionInput = {},
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
): Promise<DirectoryImportSessionRecord> {
  assertDirectoryManageAccess(auth);
  const session = await loadImportSession(client, auth.tenantId, sessionId);
  if (!session) {
    throw new ApiError(404, "Import session not found");
  }
  if (session.status === "cancelled") {
    throw new ApiError(409, "Cancelled import sessions cannot be applied.");
  }

  if (input.rows?.length) {
    for (const override of input.rows) {
      await updateContactImportRow(client, auth, sessionId, override.row_id, {
        selected_action: override.selected_action,
        selected_contact_id: override.selected_contact_id,
        resolved_organization_id: override.resolved_organization_id,
        review_note: override.review_note
      });
    }
  }

  const rows = await loadImportRows(client, auth.tenantId, sessionId);
  let appliedCount = 0;

  for (const row of rows) {
    if (row.status === "applied" || row.status === "skipped") {
      continue;
    }

    const normalizedValues = toNormalizedValues(row.normalized_values);
    const validationErrors = toStringArray(row.validation_errors);
    const selectedAction = row.selected_action ?? row.proposed_action;
    const reviewNote = normalizeOptionalText(row.review_note);
    const resolvedOrganizationId = row.resolved_organization_id ?? normalizedValues.resolved_organization_id;

    if (selectedAction === "skip") {
      await markImportRowResult(client, auth.tenantId, row.id, {
        status: "skipped",
        resultSummary: "Skipped during import review."
      });
      continue;
    }

    if (validationErrors.length) {
      await markImportRowResult(client, auth.tenantId, row.id, {
        status: "error",
        resultSummary: validationErrors.join(" ")
      });
      continue;
    }

    if (!resolvedOrganizationId) {
      await markImportRowResult(client, auth.tenantId, row.id, {
        status: "needs_review",
        resultSummary: "Resolve the organization before applying this row."
      });
      continue;
    }

    const liveCandidates = await findImportCandidateMatches(client, auth.tenantId, {
      firstName: normalizedValues.first_name,
      lastName: normalizedValues.last_name,
      email: normalizedValues.email,
      phone: normalizedValues.phone,
      organizationId: resolvedOrganizationId
    });

    if (selectedAction === "link_existing") {
      const selectedContactId =
        row.selected_contact_id ??
        (liveCandidates.length === 1 ? liveCandidates[0].contact_id : null);
      if (!selectedContactId) {
        await markImportRowResult(client, auth.tenantId, row.id, {
          status: "needs_review",
          resultSummary: "Select the matching contact before linking this import row."
        });
        continue;
      }

      const relationshipId = await saveRelationshipFromImport(client, auth, {
        organizationId: resolvedOrganizationId,
        contactId: selectedContactId,
        relationshipRole: normalizedValues.relationship_role ?? "general",
        startDate: normalizedValues.start_date,
        endDate: normalizedValues.end_date,
        isCurrent: normalizedValues.is_current
      });

      await markImportRowResult(client, auth.tenantId, row.id, {
        status: "applied",
        appliedContactId: selectedContactId,
        appliedRelationshipId: relationshipId,
        resultSummary: "Linked to an existing contact and saved relationship history."
      });
      appliedCount += 1;
      continue;
    }

    if (selectedAction === "create_contact") {
      if (liveCandidates.length && !reviewNote) {
        await markImportRowResult(client, auth.tenantId, row.id, {
          status: "needs_review",
          resultSummary: "Add a review note before creating a new contact when duplicate candidates exist."
        });
        continue;
      }

      const created = await createImportedContact(client, auth, {
        organizationId: resolvedOrganizationId,
        normalizedValues,
        reviewNote
      });

      await markImportRowResult(client, auth.tenantId, row.id, {
        status: "applied",
        appliedContactId: created.contactId,
        appliedRelationshipId: created.relationshipId,
        resultSummary: liveCandidates.length
          ? "Created a new contact with an explicit review note and saved relationship history."
          : "Created a new contact and linked the relationship."
      });
      appliedCount += 1;
      continue;
    }

    await markImportRowResult(client, auth.tenantId, row.id, {
      status: "needs_review",
      resultSummary: "Choose create, link, or skip before applying this row."
    });
  }

  await refreshImportSessionSummary(client, auth.tenantId, sessionId);
  const refreshedRows = await loadImportRows(client, auth.tenantId, sessionId);
  const nextStatus = deriveImportSessionStatus(refreshedRows);
  await client.query(
    `
      UPDATE directory_import_session
      SET
        status = $3,
        applied_by_user_id = CASE WHEN $4::int > 0 THEN $5 ELSE applied_by_user_id END,
        applied_at = CASE WHEN $4::int > 0 THEN now() ELSE applied_at END,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, sessionId, nextStatus, appliedCount, auth.id]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "directory.contact_import_session_applied",
    entityType: "directory_import_session",
    entityId: sessionId,
    metadata: {
      applied_rows: appliedCount,
      final_status: nextStatus
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return getContactImportSession(client, auth, sessionId);
}

async function prepareImportRow(
  client: PoolClient,
  auth: AuthUser,
  input: {
    rowNumber: number;
    headers: string[];
    values: string[];
    mapping: DirectoryImportColumnMapping;
    defaultOrganizationId: string | null;
  }
): Promise<PreparedImportRow> {
  const rawValues = buildImportRawValues(input.headers, input.values);
  const validationErrors: string[] = [];
  const warningMessages: string[] = [];

  const firstName = normalizeOptionalText(valueForMappedColumn(rawValues, input.mapping.first_name));
  const preferredName = normalizeOptionalText(valueForMappedColumn(rawValues, input.mapping.preferred_name));
  const storedFirstName = firstName ?? preferredName;
  const lastName = normalizeOptionalText(valueForMappedColumn(rawValues, input.mapping.last_name));
  const title = normalizeOptionalText(valueForMappedColumn(rawValues, input.mapping.title));
  const email = normalizeEmail(valueForMappedColumn(rawValues, input.mapping.email), validationErrors);
  const phone = normalizeOptionalText(valueForMappedColumn(rawValues, input.mapping.phone));
  const organizationName = normalizeOptionalText(valueForMappedColumn(rawValues, input.mapping.organization_name));
  const organizationType = normalizeOrganizationAccountType(valueForMappedColumn(rawValues, input.mapping.organization_type), warningMessages);
  const relationshipRole = normalizeRelationshipRole(valueForMappedColumn(rawValues, input.mapping.relationship_role), warningMessages);
  const notes = mergeImportedNotes({
    baseNotes: normalizeOptionalText(valueForMappedColumn(rawValues, input.mapping.notes)),
    preferredName
  });
  const startDate = normalizeImportDate(valueForMappedColumn(rawValues, input.mapping.start_date), validationErrors, "start_date");
  const endDate = normalizeImportDate(valueForMappedColumn(rawValues, input.mapping.end_date), validationErrors, "end_date");
  const currentFlag = parseImportBoolean(valueForMappedColumn(rawValues, input.mapping.current_flag), warningMessages);
  const isCurrent = currentFlag ?? (endDate ? false : true);

  if (!storedFirstName) {
    validationErrors.push("first_name is required");
  }
  if (!lastName) {
    validationErrors.push("last_name is required");
  }
  if (startDate && endDate && endDate < startDate) {
    validationErrors.push("end_date must be on or after start_date");
  }
  if (isCurrent && endDate) {
    validationErrors.push("Current relationships cannot include an end_date");
  }

  const organizationResolution = await resolveOrganizationForImportRow(client, auth.tenantId, {
    organizationName,
    organizationType,
    defaultOrganizationId: input.defaultOrganizationId
  });
  warningMessages.push(...organizationResolution.warnings);

  const candidateMatches = await findImportCandidateMatches(client, auth.tenantId, {
    firstName: storedFirstName,
    lastName,
    email,
    phone,
    organizationId: organizationResolution.organizationId
  });

  const proposedAction = deriveProposedImportAction({
    validationErrors,
    candidateMatches,
    resolvedOrganizationId: organizationResolution.organizationId
  });
  const selectedAction =
    proposedAction === "link_existing" && candidateMatches.length === 1
      ? "link_existing"
      : proposedAction === "create_contact"
        ? "create_contact"
        : null;
  const selectedContactId =
    proposedAction === "link_existing" && candidateMatches.length === 1 ? candidateMatches[0].contact_id : null;
  const status = deriveImportRowStatus({
    validationErrors,
    candidateMatches,
    selectedAction,
    selectedContactId,
    resolvedOrganizationId: organizationResolution.organizationId,
    reviewNote: null
  });

  return {
    row_number: input.rowNumber,
    raw_values: rawValues,
    normalized_values: {
      first_name: storedFirstName,
      last_name: lastName,
      preferred_name: preferredName,
      title,
      email,
      phone,
      organization_name: organizationName,
      organization_type: organizationType,
      relationship_role: relationshipRole,
      notes,
      start_date: startDate,
      end_date: endDate,
      is_current: isCurrent,
      active_status: "active",
      resolved_organization_id: organizationResolution.organizationId,
      resolved_organization_name: organizationResolution.organizationName
    },
    validation_errors: dedupeMessages(validationErrors),
    warning_messages: dedupeMessages(warningMessages),
    candidate_matches: candidateMatches,
    proposed_action: proposedAction,
    selected_action: selectedAction,
    selected_contact_id: selectedContactId,
    status,
    review_note: null
  };
}

async function resolveOrganizationForImportRow(
  client: PoolClient,
  tenantId: string,
  input: {
    organizationName: string | null;
    organizationType: OrganizationAccountType | null;
    defaultOrganizationId: string | null;
  }
) {
  if (!input.organizationName) {
    if (!input.defaultOrganizationId) {
      return {
        organizationId: null,
        organizationName: null,
        warnings: ["No organization_name was supplied, so this row needs review before it can be applied."]
      };
    }
    const defaultOrganization = await loadOrganization(client, tenantId, input.defaultOrganizationId);
    return {
      organizationId: defaultOrganization?.id ?? null,
      organizationName: defaultOrganization?.display_name ?? null,
      warnings: defaultOrganization ? [] : ["The default organization could not be found."]
    };
  }

  const normalizedName = normalizeDirectoryText(input.organizationName);
  const values = [tenantId, normalizedName];
  let typeFilterSql = "";
  if (input.organizationType) {
    typeFilterSql = " AND o.account_type = $3";
    values.push(input.organizationType);
  }

  const { rows } = await client.query<OrganizationLookupRow>(
    `
      SELECT o.id, o.display_name, o.account_type
      FROM organization o
      WHERE o.tenant_id = $1
        AND (
          o.normalized_canonical_name = $2
          OR lower(regexp_replace(COALESCE(o.display_name, ''), '[^a-zA-Z0-9]+', ' ', 'g')) = $2
          OR EXISTS (
            SELECT 1
            FROM organization_alias oa
            WHERE oa.tenant_id = o.tenant_id
              AND oa.organization_id = o.id
              AND oa.normalized_alias = $2
          )
        )
        ${typeFilterSql}
      ORDER BY lower(o.display_name)
      LIMIT 3
    `,
    values
  );

  if (!rows.length) {
    return {
      organizationId: null,
      organizationName: input.organizationName,
      warnings: [`No matching organization was found for "${input.organizationName}".`]
    };
  }
  if (rows.length > 1) {
    return {
      organizationId: null,
      organizationName: input.organizationName,
      warnings: [`"${input.organizationName}" matched multiple organizations and needs review.`]
    };
  }
  return {
    organizationId: rows[0].id,
    organizationName: rows[0].display_name,
    warnings: []
  };
}

async function findImportCandidateMatches(
  client: PoolClient,
  tenantId: string,
  input: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    organizationId: string | null;
  }
): Promise<DirectoryImportCandidateMatch[]> {
  const candidateMap = new Map<string, DirectoryImportCandidateMatch>();
  const fullName = [input.firstName, input.lastName].filter(Boolean).join(" ").trim();
  const normalizedFullName = fullName ? normalizeDirectoryText(fullName) : null;
  const phoneDigits = normalizePhoneDigits(input.phone);

  if (input.email) {
    const { rows } = await client.query<ImportContactCandidateRow>(
      `
        SELECT
          oc.id,
          oc.full_name,
          oc.email,
          oc.phone,
          COALESCE(
            (
              SELECT json_agg(DISTINCT o.display_name ORDER BY o.display_name)
              FROM organization_contact_relationship ocr
              JOIN organization o
                ON o.tenant_id = ocr.tenant_id
               AND o.id = ocr.organization_id
              WHERE ocr.tenant_id = oc.tenant_id
                AND ocr.contact_id = oc.id
                AND ocr.is_current = true
            ),
            '[]'::json
          ) AS current_organization_labels
        FROM organization_contact oc
        WHERE oc.tenant_id = $1
          AND lower(COALESCE(oc.email, '')) = $2
        LIMIT 5
      `,
      [tenantId, input.email]
    );
    for (const row of rows) {
      candidateMap.set(row.id, {
        contact_id: row.id,
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        current_organization_labels: toStringArray(row.current_organization_labels),
        confidence: "exact",
        reason: "Exact email match"
      });
    }
  }

  if (normalizedFullName && phoneDigits) {
    const { rows } = await client.query<ImportContactCandidateRow>(
      `
        SELECT
          oc.id,
          oc.full_name,
          oc.email,
          oc.phone,
          COALESCE(
            (
              SELECT json_agg(DISTINCT o.display_name ORDER BY o.display_name)
              FROM organization_contact_relationship ocr
              JOIN organization o
                ON o.tenant_id = ocr.tenant_id
               AND o.id = ocr.organization_id
              WHERE ocr.tenant_id = oc.tenant_id
                AND ocr.contact_id = oc.id
                AND ocr.is_current = true
            ),
            '[]'::json
          ) AS current_organization_labels
        FROM organization_contact oc
        WHERE oc.tenant_id = $1
          AND oc.normalized_full_name = $2
          AND regexp_replace(COALESCE(oc.phone, ''), '[^0-9]+', '', 'g') = $3
        LIMIT 5
      `,
      [tenantId, normalizedFullName, phoneDigits]
    );
    for (const row of rows) {
      maybeAddCandidate(candidateMap, {
        contact_id: row.id,
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        current_organization_labels: toStringArray(row.current_organization_labels),
        confidence: "strong",
        reason: "Matching full name and phone"
      });
    }
  }

  if (normalizedFullName && input.organizationId) {
    const { rows } = await client.query<ImportContactCandidateRow>(
      `
        SELECT
          oc.id,
          oc.full_name,
          oc.email,
          oc.phone,
          COALESCE(
            (
              SELECT json_agg(DISTINCT o.display_name ORDER BY o.display_name)
              FROM organization_contact_relationship current_rel
              JOIN organization o
                ON o.tenant_id = current_rel.tenant_id
               AND o.id = current_rel.organization_id
              WHERE current_rel.tenant_id = oc.tenant_id
                AND current_rel.contact_id = oc.id
                AND current_rel.is_current = true
            ),
            '[]'::json
          ) AS current_organization_labels
        FROM organization_contact oc
        JOIN organization_contact_relationship ocr
          ON ocr.tenant_id = oc.tenant_id
         AND ocr.contact_id = oc.id
         AND ocr.organization_id = $3
         AND ocr.is_current = true
        WHERE oc.tenant_id = $1
          AND oc.normalized_full_name = $2
        LIMIT 5
      `,
      [tenantId, normalizedFullName, input.organizationId]
    );
    for (const row of rows) {
      maybeAddCandidate(candidateMap, {
        contact_id: row.id,
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        current_organization_labels: toStringArray(row.current_organization_labels),
        confidence: "strong",
        reason: "Matching full name and current organization"
      });
    }
  }

  return [...candidateMap.values()].sort(compareCandidateMatches);
}

async function createImportedContact(
  client: PoolClient,
  auth: AuthUser,
  input: {
    organizationId: string;
    normalizedValues: NormalizedImportRow;
    reviewNote: string | null;
  }
) {
  const firstName = input.normalizedValues.first_name;
  const lastName = input.normalizedValues.last_name;
  if (!firstName || !lastName) {
    throw new ApiError(400, "Imported contacts require first and last names.");
  }

  const fullName = `${firstName} ${lastName}`.trim();
  const normalizedFullName = normalizeDirectoryText(fullName);
  const email = input.normalizedValues.email?.toLowerCase() ?? null;
  const existing = await client.query<{ id: string }>(
    `
      SELECT oc.id
      FROM organization_contact oc
      LEFT JOIN organization_contact_relationship ocr
        ON ocr.tenant_id = oc.tenant_id
       AND ocr.contact_id = oc.id
       AND ocr.organization_id = $2
       AND ocr.is_current = true
      WHERE oc.tenant_id = $1
        AND (
          ($3::text IS NOT NULL AND lower(COALESCE(oc.email, '')) = $3)
          OR (
            oc.normalized_full_name = $4
            AND regexp_replace(COALESCE(oc.phone, ''), '[^0-9]+', '', 'g') = $5
          )
        )
      LIMIT 1
    `,
    [
      auth.tenantId,
      input.organizationId,
      email,
      normalizedFullName,
      normalizePhoneDigits(input.normalizedValues.phone)
    ]
  );
  if (existing.rows[0]) {
    throw new ApiError(409, "A matching contact already exists, so this import row needs review before creating a duplicate.");
  }

  const insert = await client.query<{ id: string }>(
    `
      INSERT INTO organization_contact (
        tenant_id,
        organization_id,
        first_name,
        last_name,
        full_name,
        normalized_full_name,
        title,
        phone,
        email,
        active_status,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
      RETURNING id
    `,
    [
      auth.tenantId,
      input.organizationId,
      firstName,
      lastName,
      fullName,
      normalizedFullName,
      input.normalizedValues.title,
      input.normalizedValues.phone,
      email,
      input.normalizedValues.active_status,
      input.normalizedValues.notes,
      auth.id
    ]
  );
  const contactId = insert.rows[0].id;
  const relationshipId = await saveRelationshipFromImport(client, auth, {
    organizationId: input.organizationId,
    contactId,
    relationshipRole: input.normalizedValues.relationship_role ?? "general",
    startDate: input.normalizedValues.start_date,
    endDate: input.normalizedValues.end_date,
    isCurrent: input.normalizedValues.is_current
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "directory.contact_import_contact_created",
    entityType: "organization_contact",
    entityId: contactId,
    metadata: {
      organization_id: input.organizationId,
      relationship_id: relationshipId,
      review_note: input.reviewNote
    }
  });

  return { contactId, relationshipId };
}

async function saveRelationshipFromImport(
  client: PoolClient,
  auth: AuthUser,
  input: {
    organizationId: string;
    contactId: string;
    relationshipRole: DirectoryContactRelationshipRole;
    startDate: string | null;
    endDate: string | null;
    isCurrent: boolean;
  }
) {
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    throw new ApiError(400, "Relationship end dates must be on or after the start date.");
  }

  if (input.isCurrent) {
    const { rows } = await client.query<{ id: string }>(
      `
        INSERT INTO organization_contact_relationship (
          tenant_id,
          organization_id,
          contact_id,
          relationship_role,
          is_primary,
          start_date,
          end_date,
          is_current,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES ($1,$2,$3,$4,false,$5,NULL,true,$6,$6)
        ON CONFLICT (tenant_id, organization_id, contact_id)
          WHERE is_current
        DO UPDATE SET
          relationship_role = EXCLUDED.relationship_role,
          start_date = COALESCE(EXCLUDED.start_date, organization_contact_relationship.start_date),
          end_date = NULL,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = now()
        RETURNING id
      `,
      [auth.tenantId, input.organizationId, input.contactId, input.relationshipRole, input.startDate, auth.id]
    );
    return rows[0].id;
  }

  const existing = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization_contact_relationship
      WHERE tenant_id = $1
        AND organization_id = $2
        AND contact_id = $3
        AND is_current = false
        AND relationship_role = $4
        AND start_date IS NOT DISTINCT FROM $5::date
        AND end_date IS NOT DISTINCT FROM $6::date
      LIMIT 1
    `,
    [auth.tenantId, input.organizationId, input.contactId, input.relationshipRole, input.startDate, input.endDate]
  );
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO organization_contact_relationship (
        tenant_id,
        organization_id,
        contact_id,
        relationship_role,
        is_primary,
        start_date,
        end_date,
        is_current,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,false,$5,$6,false,$7,$7)
      RETURNING id
    `,
    [auth.tenantId, input.organizationId, input.contactId, input.relationshipRole, input.startDate, input.endDate, auth.id]
  );
  return rows[0].id;
}

async function refreshImportSessionSummary(client: PoolClient, tenantId: string, sessionId: string) {
  const rows = await loadImportRows(client, tenantId, sessionId);
  const summary = buildImportSessionSummary(rows);
  const nextStatus = deriveImportSessionStatus(rows);
  await client.query(
    `
      UPDATE directory_import_session
      SET
        summary = $3::jsonb,
        status = $4,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [tenantId, sessionId, JSON.stringify(summary), nextStatus]
  );
}

function buildImportSessionSummary(rows: ImportRowDb[]): DirectoryImportSessionSummary {
  return {
    total_rows: rows.length,
    ready_to_create: rows.filter((row) => row.status === "ready" && (row.selected_action ?? row.proposed_action) === "create_contact")
      .length,
    ready_to_link: rows.filter((row) => row.status === "ready" && (row.selected_action ?? row.proposed_action) === "link_existing").length,
    needs_review: rows.filter((row) => row.status === "needs_review").length,
    skipped: rows.filter((row) => row.status === "skipped").length,
    invalid: rows.filter((row) => row.status === "error").length,
    applied: rows.filter((row) => row.status === "applied").length,
    errors: rows.filter((row) => row.status === "error").length
  };
}

function deriveImportSessionStatus(rows: ImportRowDb[]): DirectoryImportSessionStatus {
  if (!rows.length) {
    return "staged";
  }
  const actionableRemaining = rows.some((row) => row.status === "ready" || row.status === "needs_review" || row.status === "error");
  const hasApplied = rows.some((row) => row.status === "applied");
  if (hasApplied && actionableRemaining) {
    return "partially_applied";
  }
  if (hasApplied && rows.every((row) => row.status === "applied" || row.status === "skipped")) {
    return "applied";
  }
  return "staged";
}

function deriveImportRowStatus(input: {
  validationErrors: string[];
  candidateMatches: DirectoryImportCandidateMatch[];
  selectedAction: DirectoryImportRowAction | null | undefined;
  selectedContactId: string | null | undefined;
  resolvedOrganizationId: string | null | undefined;
  reviewNote: string | null | undefined;
}): DirectoryImportRowStatus {
  if (input.selectedAction === "skip") {
    return "skipped";
  }
  if (input.validationErrors.length) {
    return "error";
  }
  if (!input.resolvedOrganizationId) {
    return "needs_review";
  }
  if (!input.selectedAction || input.selectedAction === "needs_review") {
    return "needs_review";
  }
  if (input.selectedAction === "link_existing") {
    const hasSingleCandidate = input.candidateMatches.length === 1;
    return input.selectedContactId || hasSingleCandidate ? "ready" : "needs_review";
  }
  if (input.selectedAction === "create_contact") {
    return input.candidateMatches.length > 0 && !normalizeOptionalText(input.reviewNote) ? "needs_review" : "ready";
  }
  return "needs_review";
}

function deriveProposedImportAction(input: {
  validationErrors: string[];
  candidateMatches: DirectoryImportCandidateMatch[];
  resolvedOrganizationId: string | null;
}): DirectoryImportRowAction {
  if (input.validationErrors.length) {
    return "skip";
  }
  if (!input.resolvedOrganizationId) {
    return "needs_review";
  }
  if (input.candidateMatches.length === 1 && input.candidateMatches[0].confidence !== "possible") {
    return "link_existing";
  }
  if (input.candidateMatches.length > 0) {
    return "needs_review";
  }
  return "create_contact";
}

function resolveImportColumnMapping(headers: string[], explicit: DirectoryImportColumnMapping): DirectoryImportColumnMapping {
  const normalizedHeaders = new Map(headers.map((header) => [normalizeHeaderName(header), header]));
  const mapping: DirectoryImportColumnMapping = {};
  for (const key of IMPORT_COLUMN_KEYS) {
    const explicitHeader = normalizeOptionalText(explicit[key] ?? null);
    if (explicitHeader) {
      mapping[key] = explicitHeader;
      continue;
    }
    const detectedHeader = IMPORT_COLUMN_ALIASES[key]
      .map((alias) => normalizedHeaders.get(normalizeHeaderName(alias)))
      .find(Boolean);
    if (detectedHeader) {
      mapping[key] = detectedHeader;
    }
  }
  return mapping;
}

function parseCsv(source: string) {
  const rows: string[][] = [];
  let currentValue = "";
  let currentRow: string[] = [];
  let insideQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '"') {
      if (insideQuotes && next === '"') {
        currentValue += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }
    if (char === "," && !insideQuotes) {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      currentRow.push(currentValue);
      if (currentRow.some((value) => value.trim().length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentValue = "";
      continue;
    }
    currentValue += char;
  }

  if (currentValue.length || currentRow.length) {
    currentRow.push(currentValue);
    if (currentRow.some((value) => value.trim().length > 0)) {
      rows.push(currentRow);
    }
  }

  const [headerRow, ...valueRows] = rows;
  return {
    headers: (headerRow ?? []).map((value) => value.trim()),
    rows: valueRows.map((row) => row.map((value) => value.trim()))
  };
}

function buildImportRawValues(headers: string[], values: string[]) {
  const record: Record<string, string | null> = {};
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index]?.trim();
    if (!header) {
      continue;
    }
    record[header] = normalizeOptionalText(values[index] ?? null);
  }
  return record;
}

function valueForMappedColumn(rawValues: Record<string, string | null>, mappedColumn?: string | null) {
  if (!mappedColumn) {
    return null;
  }
  return rawValues[mappedColumn] ?? null;
}

function normalizeRequiredText(value: string | null | undefined, message: string) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new ApiError(400, message);
  }
  return normalized;
}

function normalizeOptionalText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeEmail(value: string | null, validationErrors: string[]) {
  const email = normalizeOptionalText(value)?.toLowerCase() ?? null;
  if (!email) {
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    validationErrors.push(`"${value}" is not a valid email address`);
    return null;
  }
  return email;
}

function normalizePhoneDigits(value?: string | null) {
  const digits = (value ?? "").replace(/[^0-9]+/g, "");
  return digits || null;
}

function normalizeOrganizationAccountType(
  value: string | null,
  warningMessages: string[]
): OrganizationAccountType | null {
  const normalized = normalizeDirectoryText(value);
  if (!normalized) {
    return null;
  }
  const mapped: Record<string, OrganizationAccountType> = {
    school: "schools_underclass_portraits",
    schools: "schools_underclass_portraits",
    district: "schools_underclass_portraits",
    league: "sports",
    sports: "sports",
    events: "events",
    event: "events",
    studio: "studio",
    headshots: "headshots",
    headshot: "headshots",
    commercial: "commercial",
    internal: "internal"
  };
  if (mapped[normalized]) {
    return mapped[normalized];
  }
  if (
    [
      "schools_underclass_portraits",
      "schools_events",
      "sports",
      "events",
      "studio",
      "headshots",
      "commercial",
      "internal"
    ].includes(normalized)
  ) {
    return normalized as OrganizationAccountType;
  }
  warningMessages.push(`"${value}" is not a recognized organization type.`);
  return null;
}

function normalizeRelationshipRole(
  value: string | null,
  warningMessages: string[]
): DirectoryContactRelationshipRole | null {
  const normalized = normalizeDirectoryText(value);
  if (!normalized) {
    return null;
  }
  const mapped: Record<string, DirectoryContactRelationshipRole> = {
    general: "general",
    planning: "planning",
    billing: "billing",
    "decision maker": "decision_maker",
    decision_maker: "decision_maker",
    "day of": "day_of",
    day_of: "day_of",
    operations: "operations",
    other: "other"
  };
  if (mapped[normalized]) {
    return mapped[normalized];
  }
  warningMessages.push(`"${value}" is not a recognized relationship role.`);
  return null;
}

function normalizeImportDate(value: string | null, validationErrors: string[], field: string) {
  const trimmed = normalizeOptionalText(value);
  if (!trimmed) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const month = usMatch[1].padStart(2, "0");
    const day = usMatch[2].padStart(2, "0");
    return `${usMatch[3]}-${month}-${day}`;
  }
  validationErrors.push(`${field} must use YYYY-MM-DD or MM/DD/YYYY.`);
  return null;
}

function parseImportBoolean(value: string | null, warningMessages: string[]) {
  const normalized = normalizeDirectoryText(value);
  if (!normalized) {
    return null;
  }
  if (["yes", "y", "true", "1", "current", "active"].includes(normalized)) {
    return true;
  }
  if (["no", "n", "false", "0", "previous", "inactive"].includes(normalized)) {
    return false;
  }
  warningMessages.push(`"${value}" could not be interpreted as a current/active flag.`);
  return null;
}

function mergeImportedNotes(input: { baseNotes: string | null; preferredName: string | null }) {
  const lines: string[] = [];
  if (input.preferredName) {
    lines.push(`Preferred name: ${input.preferredName}`);
  }
  if (input.baseNotes) {
    lines.push(input.baseNotes);
  }
  return lines.length ? lines.join("\n") : null;
}

function normalizeHeaderName(value?: string | null) {
  return normalizeDirectoryText(value).replace(/\s+/g, "_");
}

function normalizeDirectoryText(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function maybeAddCandidate(map: Map<string, DirectoryImportCandidateMatch>, candidate: DirectoryImportCandidateMatch) {
  const existing = map.get(candidate.contact_id);
  if (!existing || compareCandidateMatches(candidate, existing) < 0) {
    map.set(candidate.contact_id, candidate);
  }
}

function compareCandidateMatches(left: DirectoryImportCandidateMatch, right: DirectoryImportCandidateMatch) {
  return candidateConfidenceWeight(left.confidence) - candidateConfidenceWeight(right.confidence);
}

function candidateConfidenceWeight(confidence: DirectoryImportCandidateMatch["confidence"]) {
  switch (confidence) {
    case "exact":
      return 0;
    case "strong":
      return 1;
    default:
      return 2;
  }
}

function dedupeMessages(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function toCandidateMatches(value: unknown): DirectoryImportCandidateMatch[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      return {
        contact_id: String(record.contact_id ?? ""),
        full_name: String(record.full_name ?? ""),
        email: record.email ? String(record.email) : null,
        phone: record.phone ? String(record.phone) : null,
        current_organization_labels: toStringArray(record.current_organization_labels),
        confidence: (record.confidence as DirectoryImportCandidateMatch["confidence"]) ?? "possible",
        reason: String(record.reason ?? "")
      };
    })
    .filter((item): item is DirectoryImportCandidateMatch => Boolean(item?.contact_id));
}

function toNormalizedValues(value: unknown): NormalizedImportRow {
  const record = (value ?? {}) as Record<string, unknown>;
  return {
    first_name: record.first_name ? String(record.first_name) : null,
    last_name: record.last_name ? String(record.last_name) : null,
    preferred_name: record.preferred_name ? String(record.preferred_name) : null,
    title: record.title ? String(record.title) : null,
    email: record.email ? String(record.email) : null,
    phone: record.phone ? String(record.phone) : null,
    organization_name: record.organization_name ? String(record.organization_name) : null,
    organization_type: (record.organization_type as OrganizationAccountType | null) ?? null,
    relationship_role: (record.relationship_role as DirectoryContactRelationshipRole | null) ?? null,
    notes: record.notes ? String(record.notes) : null,
    start_date: record.start_date ? String(record.start_date) : null,
    end_date: record.end_date ? String(record.end_date) : null,
    is_current: Boolean(record.is_current ?? true),
    active_status: (record.active_status as DirectoryActiveStatus | null) ?? "active",
    resolved_organization_id: record.resolved_organization_id ? String(record.resolved_organization_id) : null,
    resolved_organization_name: record.resolved_organization_name ? String(record.resolved_organization_name) : null
  };
}

async function loadImportSession(client: PoolClient, tenantId: string, sessionId: string) {
  const { rows } = await client.query<ImportSessionRow>(
    `
      SELECT
        id,
        source_file_name,
        import_kind,
        status,
        has_header_row,
        default_organization_id,
        mapping,
        summary,
        created_by_user_id,
        applied_by_user_id,
        applied_at::text,
        created_at::text,
        updated_at::text
      FROM directory_import_session
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, sessionId]
  );
  return rows[0] ?? null;
}

async function loadImportRows(client: PoolClient, tenantId: string, sessionId: string) {
  const { rows } = await client.query<ImportRowDb>(
    `
      SELECT
        id,
        row_number,
        status,
        proposed_action,
        selected_action,
        selected_contact_id,
        resolved_organization_id,
        raw_values,
        normalized_values,
        validation_errors,
        warning_messages,
        candidate_matches,
        review_note,
        applied_contact_id,
        applied_relationship_id,
        result_summary
      FROM directory_import_row
      WHERE tenant_id = $1
        AND session_id = $2
      ORDER BY row_number ASC
    `,
    [tenantId, sessionId]
  );
  return rows;
}

async function loadImportRow(client: PoolClient, tenantId: string, sessionId: string, rowId: string) {
  const { rows } = await client.query<ImportRowDb>(
    `
      SELECT
        id,
        row_number,
        status,
        proposed_action,
        selected_action,
        selected_contact_id,
        resolved_organization_id,
        raw_values,
        normalized_values,
        validation_errors,
        warning_messages,
        candidate_matches,
        review_note,
        applied_contact_id,
        applied_relationship_id,
        result_summary
      FROM directory_import_row
      WHERE tenant_id = $1
        AND session_id = $2
        AND id = $3
      LIMIT 1
    `,
    [tenantId, sessionId, rowId]
  );
  return rows[0] ?? null;
}

function mapImportSession(session: ImportSessionRow, rows: ImportRowDb[]): DirectoryImportSessionRecord {
  return {
    id: session.id,
    source_file_name: session.source_file_name,
    import_kind: "contacts_csv",
    status: session.status,
    has_header_row: session.has_header_row,
    default_organization_id: session.default_organization_id,
    mapping: ((session.mapping ?? {}) as DirectoryImportColumnMapping) ?? {},
    summary: normalizeImportSummary(session.summary, rows),
    created_by_user_id: session.created_by_user_id,
    applied_by_user_id: session.applied_by_user_id,
    applied_at: session.applied_at,
    created_at: session.created_at,
    updated_at: session.updated_at,
    rows: rows.map((row) => ({
      id: row.id,
      row_number: row.row_number,
      status: row.status,
      proposed_action: row.proposed_action,
      selected_action: row.selected_action,
      selected_contact_id: row.selected_contact_id,
      resolved_organization_id: row.resolved_organization_id,
      review_note: row.review_note,
      raw_values: (row.raw_values as Record<string, string | null>) ?? {},
      normalized_values: toNormalizedValues(row.normalized_values),
      validation_errors: toStringArray(row.validation_errors),
      warning_messages: toStringArray(row.warning_messages),
      candidate_matches: toCandidateMatches(row.candidate_matches),
      applied_contact_id: row.applied_contact_id,
      applied_relationship_id: row.applied_relationship_id,
      result_summary: row.result_summary
    }))
  };
}

function mapImportSessionListItem(session: ImportSessionRow): DirectoryImportSessionListItem {
  return {
    id: session.id,
    source_file_name: session.source_file_name,
    import_kind: "contacts_csv",
    status: session.status,
    has_header_row: session.has_header_row,
    default_organization_id: session.default_organization_id,
    summary: normalizeImportSummary(session.summary, []),
    created_by_user_id: session.created_by_user_id,
    applied_by_user_id: session.applied_by_user_id,
    applied_at: session.applied_at,
    created_at: session.created_at,
    updated_at: session.updated_at
  };
}

function normalizeImportSummary(value: unknown, rows: ImportRowDb[]): DirectoryImportSessionSummary {
  const record = (value ?? {}) as Record<string, unknown>;
  return {
    total_rows: Number(record.total_rows ?? rows.length),
    ready_to_create: Number(record.ready_to_create ?? 0),
    ready_to_link: Number(record.ready_to_link ?? 0),
    needs_review: Number(record.needs_review ?? 0),
    skipped: Number(record.skipped ?? 0),
    invalid: Number(record.invalid ?? 0),
    applied: Number(record.applied ?? 0),
    errors: Number(record.errors ?? 0)
  };
}

async function assertImportSessionExists(client: PoolClient, tenantId: string, sessionId: string) {
  const session = await loadImportSession(client, tenantId, sessionId);
  if (!session) {
    throw new ApiError(404, "Import session not found");
  }
}

async function assertOrganizationExists(client: PoolClient, tenantId: string, organizationId: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, organizationId]
  );
  if (!rows[0]) {
    throw new ApiError(400, "The selected organization could not be found.");
  }
}

async function assertContactExists(client: PoolClient, tenantId: string, contactId: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization_contact
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, contactId]
  );
  if (!rows[0]) {
    throw new ApiError(400, "The selected contact could not be found.");
  }
}

async function loadOrganization(client: PoolClient, tenantId: string, organizationId: string) {
  const { rows } = await client.query<OrganizationLookupRow>(
    `
      SELECT id, display_name, account_type
      FROM organization
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, organizationId]
  );
  return rows[0] ?? null;
}

async function markImportRowResult(
  client: PoolClient,
  tenantId: string,
  rowId: string,
  input: {
    status: DirectoryImportRowStatus;
    appliedContactId?: string | null;
    appliedRelationshipId?: string | null;
    resultSummary: string;
  }
) {
  await client.query(
    `
      UPDATE directory_import_row
      SET
        status = $3,
        applied_contact_id = COALESCE($4, applied_contact_id),
        applied_relationship_id = COALESCE($5, applied_relationship_id),
        result_summary = $6,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [tenantId, rowId, input.status, input.appliedContactId ?? null, input.appliedRelationshipId ?? null, input.resultSummary]
  );
}

function assertDirectoryManageAccess(auth: AuthUser) {
  if (!canManageCanonicalDirectoryRecords(auth)) {
    throw new ApiError(403, "You do not have permission to import or update directory contact data.");
  }
}
