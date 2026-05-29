import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "../config.js";

type AgreementEnvelopeRow = {
  id: string;
  agreement_title: string;
  status: string;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  countersigned_at: string | null;
  external_provider_name: string | null;
  external_envelope_id: string | null;
  external_status: string | null;
  last_provider_sync_at: string | null;
  provider_error_state: string | null;
  provider_metadata: Record<string, unknown> | null;
};

type AgreementSignerRow = {
  id: string;
  signer_name: string;
  signer_email: string | null;
  signer_type: "external" | "internal" | "countersigner";
  status: "pending" | "viewed" | "signed" | "replaced" | "cancelled";
  external_recipient_id: string | null;
  external_status: string | null;
  viewed_at: string | null;
  signed_at: string | null;
};

type ProviderSendPayload = {
  agreement_id: string;
  agreement_title: string;
  provider_name?: string | null;
  provider_event_id?: string | null;
  signer_recipients?: Array<{
    signer_id: string;
    signer_name: string;
    signer_email: string | null;
    signer_type: "external" | "internal" | "countersigner";
    signer_order: number | null;
  }>;
};

type ProviderReminderPayload = {
  agreement_id: string;
  provider_name?: string | null;
  external_envelope_id?: string | null;
  provider_event_id?: string | null;
  reminder_type?: string | null;
};

type ProviderSyncPayload = {
  agreement_id: string;
  provider_name?: string | null;
  external_envelope_id?: string | null;
  provider_event_id?: string | null;
};

type ProviderSignerSnapshot = {
  signer_id?: string | null;
  signer_email?: string | null;
  external_recipient_id?: string | null;
  external_status?: string | null;
  viewed_at?: string | null;
  signed_at?: string | null;
};

type ProviderFinalDocument = {
  file_name: string;
  storage_reference?: string | null;
  file_url?: string | null;
  content_type?: string | null;
  version_label?: string | null;
  version_stage?: "signed" | "countersigned_final";
};

type ProviderLifecycleSnapshot = {
  provider_name: string;
  external_envelope_id: string;
  external_status: string;
  provider_error_state?: string | null;
  occurred_at?: string | null;
  provider_metadata?: Record<string, unknown>;
  provider_event_type?:
    | "sent"
    | "sync_updated"
    | "viewed"
    | "signed"
    | "countersigned"
    | "send_failed"
    | "sync_failed"
    | "cancelled"
    | "voided";
  signer_updates?: ProviderSignerSnapshot[];
  final_documents?: ProviderFinalDocument[];
};

type LifecycleEventType = NonNullable<ProviderLifecycleSnapshot["provider_event_type"]>;

type AgreementSignatureProvider = {
  name: string;
  sendAgreement(input: {
    agreement: AgreementEnvelopeRow;
    signers: AgreementSignerRow[];
    payload: ProviderSendPayload;
  }): Promise<ProviderLifecycleSnapshot>;
  sendReminder(input: {
    agreement: AgreementEnvelopeRow;
    signers: AgreementSignerRow[];
    payload: ProviderReminderPayload;
  }): Promise<Pick<ProviderLifecycleSnapshot, "provider_name" | "external_envelope_id" | "external_status" | "provider_metadata">>;
  fetchEnvelopeStatus(input: {
    agreement: AgreementEnvelopeRow;
    signers: AgreementSignerRow[];
    payload: ProviderSyncPayload;
  }): Promise<ProviderLifecycleSnapshot>;
};

const providerStub: AgreementSignatureProvider = {
  name: "provider_stub",
  async sendAgreement(input) {
    const envelopeId = input.agreement.external_envelope_id ?? `stub-envelope-${randomUUID()}`;
    return {
      provider_name: "provider_stub",
      external_envelope_id: envelopeId,
      external_status: "sent",
      provider_event_type: "sent",
      occurred_at: new Date().toISOString(),
      provider_metadata: {
        provider_mode: "stub",
        last_request_kind: "send"
      },
      signer_updates: input.signers.map((signer, index) => ({
        signer_id: signer.id,
        external_recipient_id: signer.external_recipient_id ?? `stub-recipient-${index + 1}-${randomUUID().slice(0, 8)}`,
        external_status: "sent"
      }))
    };
  },
  async sendReminder(input) {
    return {
      provider_name: "provider_stub",
      external_envelope_id: input.agreement.external_envelope_id ?? `stub-envelope-${randomUUID()}`,
      external_status: input.agreement.external_status ?? "sent",
      provider_metadata: {
        provider_mode: "stub",
        last_request_kind: "reminder",
        reminder_type: input.payload.reminder_type ?? "manual_follow_up"
      }
    };
  },
  async fetchEnvelopeStatus(input) {
    return {
      provider_name: "provider_stub",
      external_envelope_id: input.agreement.external_envelope_id ?? `stub-envelope-${randomUUID()}`,
      external_status: input.agreement.external_status ?? "sent",
      provider_event_type: "sync_updated",
      occurred_at: new Date().toISOString(),
      provider_metadata: {
        provider_mode: "stub",
        last_request_kind: "sync"
      },
      signer_updates: input.signers.map((signer) => ({
        signer_id: signer.id,
        external_recipient_id: signer.external_recipient_id,
        external_status: signer.external_status ?? signer.status,
        viewed_at: signer.viewed_at,
        signed_at: signer.signed_at
      }))
    };
  }
};

const dropboxSignProvider: AgreementSignatureProvider = {
  name: "dropbox_sign",
  async sendAgreement() {
    if (!config.AGREEMENT_ESIGN_API_KEY || !config.AGREEMENT_ESIGN_BASE_URL) {
      throw new Error("Dropbox Sign provider is not configured in this environment.");
    }
    throw new Error("Dropbox Sign live delivery is not wired yet. Use provider_stub until the live credentials and request mapping are finalized.");
  },
  async sendReminder() {
    if (!config.AGREEMENT_ESIGN_API_KEY || !config.AGREEMENT_ESIGN_BASE_URL) {
      throw new Error("Dropbox Sign provider is not configured in this environment.");
    }
    throw new Error("Dropbox Sign live reminders are not wired yet. Use provider_stub until the live credentials and request mapping are finalized.");
  },
  async fetchEnvelopeStatus() {
    if (!config.AGREEMENT_ESIGN_API_KEY || !config.AGREEMENT_ESIGN_BASE_URL) {
      throw new Error("Dropbox Sign provider is not configured in this environment.");
    }
    throw new Error("Dropbox Sign live status sync is not wired yet. Use provider_stub until the live credentials and request mapping are finalized.");
  }
};

export async function handleAgreementSignatureSend(client: PoolClient, payload: Record<string, unknown>) {
  const sendPayload = payload as unknown as ProviderSendPayload;
  const agreementId = String(sendPayload.agreement_id ?? "");
  if (!agreementId) {
    return;
  }

  const agreement = await loadAgreementById(client, agreementId);
  if (!agreement) {
    return;
  }
  const signers = await loadAgreementSigners(client, agreementId);
  const provider = getAgreementSignatureProvider(String(sendPayload.provider_name ?? agreement.external_provider_name ?? config.AGREEMENT_ESIGN_PROVIDER));

  try {
    const snapshot = await provider.sendAgreement({
      agreement,
      signers,
      payload: sendPayload
    });
    await applyAgreementProviderSnapshot(client, agreement.id, snapshot);
  } catch (error) {
    await recordAgreementProviderFailure(client, {
      agreementId: agreement.id,
      providerName: provider.name,
      externalEnvelopeId: agreement.external_envelope_id,
      failureType: "send_failed",
      message: error instanceof Error ? error.message : "Unknown provider send failure"
    });
    throw error;
  }
}

export async function handleAgreementSignatureReminder(client: PoolClient, payload: Record<string, unknown>) {
  const reminderPayload = payload as unknown as ProviderReminderPayload;
  const agreementId = String(reminderPayload.agreement_id ?? "");
  if (!agreementId) {
    return;
  }
  const agreement = await loadAgreementById(client, agreementId);
  if (!agreement) {
    return;
  }
  const signers = await loadAgreementSigners(client, agreementId);
  const provider = getAgreementSignatureProvider(String(reminderPayload.provider_name ?? agreement.external_provider_name ?? config.AGREEMENT_ESIGN_PROVIDER));
  const reminder = await provider.sendReminder({
    agreement,
    signers,
    payload: reminderPayload
  });

  const occurredAt = new Date().toISOString();
  await client.query(
    `
      UPDATE agreement
      SET
        external_provider_name = $2,
        external_envelope_id = COALESCE($3, external_envelope_id),
        external_status = COALESCE($4, external_status),
        last_provider_sync_at = $5::timestamptz,
        provider_error_state = NULL,
        provider_metadata = COALESCE(provider_metadata, '{}'::jsonb) || $6::jsonb,
        updated_at = now()
      WHERE id = $1
    `,
    [
      agreementId,
      reminder.provider_name,
      reminder.external_envelope_id,
      reminder.external_status,
      occurredAt,
      JSON.stringify(reminder.provider_metadata ?? {})
    ]
  );

  await insertAgreementProviderEvent(client, {
    agreementId,
    signerId: null,
    providerName: reminder.provider_name,
    externalEnvelopeId: reminder.external_envelope_id,
    direction: "outbound",
    eventType: "reminder_sent",
    providerStatus: reminder.external_status ?? agreement.external_status,
    payload: {
      reminder_type: reminderPayload.reminder_type ?? "manual_follow_up"
    },
    occurredAt
  });

  await insertAgreementActivityLog(client, {
    agreementId,
    activityType: "provider_reminder_sent",
    note: "Resent the Agreement through the provider reminder flow.",
    metadata: {
      provider_name: reminder.provider_name,
      reminder_type: reminderPayload.reminder_type ?? "manual_follow_up"
    }
  });
}

export async function handleAgreementSignatureSync(client: PoolClient, payload: Record<string, unknown>) {
  const syncPayload = payload as unknown as ProviderSyncPayload;
  const agreementId = String(syncPayload.agreement_id ?? "");
  if (!agreementId) {
    return;
  }
  const agreement = await loadAgreementById(client, agreementId);
  if (!agreement) {
    return;
  }
  const signers = await loadAgreementSigners(client, agreementId);
  const provider = getAgreementSignatureProvider(String(syncPayload.provider_name ?? agreement.external_provider_name ?? config.AGREEMENT_ESIGN_PROVIDER));

  try {
    const snapshot = await provider.fetchEnvelopeStatus({
      agreement,
      signers,
      payload: syncPayload
    });
    await applyAgreementProviderSnapshot(client, agreement.id, snapshot);
  } catch (error) {
    await recordAgreementProviderFailure(client, {
      agreementId: agreement.id,
      providerName: provider.name,
      externalEnvelopeId: agreement.external_envelope_id,
      failureType: "sync_failed",
      message: error instanceof Error ? error.message : "Unknown provider sync failure"
    });
    throw error;
  }
}

export async function handleAgreementSignatureWebhook(client: PoolClient, payload: Record<string, unknown>) {
  const body = normalizeRecord(payload.body);
  const providerName = String(body.provider_name ?? payload.provider_name ?? config.AGREEMENT_ESIGN_PROVIDER);
  const agreementId = typeof body.agreement_id === "string" ? body.agreement_id : await findAgreementIdByEnvelope(client, String(body.external_envelope_id ?? body.envelope_id ?? ""));
  if (!agreementId) {
    throw new Error("Agreement webhook could not be matched to an Agreement.");
  }

  const finalDocuments = Array.isArray(body.final_documents)
    ? body.final_documents
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        .map<ProviderFinalDocument>((item) => ({
          file_name: String(item.file_name ?? "signed-agreement.pdf"),
          storage_reference: typeof item.storage_reference === "string" ? item.storage_reference : null,
          file_url: typeof item.file_url === "string" ? item.file_url : null,
          content_type: typeof item.content_type === "string" ? item.content_type : null,
          version_label: typeof item.version_label === "string" ? item.version_label : null,
          version_stage: item.version_stage === "countersigned_final" ? "countersigned_final" : "signed"
        }))
    : [];

  const signerUpdates = Array.isArray(body.signer_updates)
    ? body.signer_updates
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        .map((item) => ({
          signer_id: typeof item.signer_id === "string" ? item.signer_id : null,
          signer_email: typeof item.signer_email === "string" ? item.signer_email : null,
          external_recipient_id: typeof item.external_recipient_id === "string" ? item.external_recipient_id : null,
          external_status: typeof item.external_status === "string" ? item.external_status : typeof item.status === "string" ? item.status : null,
          viewed_at: typeof item.viewed_at === "string" ? item.viewed_at : null,
          signed_at: typeof item.signed_at === "string" ? item.signed_at : null
        }))
    : [];

  await applyAgreementProviderSnapshot(client, agreementId, {
    provider_name: providerName,
    external_envelope_id: String(body.external_envelope_id ?? body.envelope_id ?? ""),
    external_status: typeof body.external_status === "string" ? body.external_status : "sent",
    provider_error_state: typeof body.provider_error_state === "string" ? body.provider_error_state : null,
    occurred_at: typeof body.occurred_at === "string" ? body.occurred_at : typeof payload.received_at === "string" ? payload.received_at : null,
    provider_metadata: {
      webhook_source: payload.provider ?? "agreement_signature"
    },
    provider_event_type: mapProviderEventTypeFromStatus(typeof body.external_status === "string" ? body.external_status : "sent"),
    signer_updates: signerUpdates,
    final_documents: finalDocuments
  });
}

function getAgreementSignatureProvider(name: string): AgreementSignatureProvider {
  if (name === "dropbox_sign") {
    return dropboxSignProvider;
  }
  return providerStub;
}

async function loadAgreementById(client: PoolClient, agreementId: string) {
  const { rows } = await client.query<AgreementEnvelopeRow>(
    `
      SELECT
        id,
        agreement_title,
        status,
        sent_at::text,
        viewed_at::text,
        signed_at::text,
        countersigned_at::text,
        external_provider_name,
        external_envelope_id,
        external_status,
        last_provider_sync_at::text,
        provider_error_state,
        provider_metadata
      FROM agreement
      WHERE id = $1
      LIMIT 1
    `,
    [agreementId]
  );
  return rows[0] ?? null;
}

async function loadAgreementSigners(client: PoolClient, agreementId: string) {
  const { rows } = await client.query<AgreementSignerRow>(
    `
      SELECT
        id,
        signer_name,
        signer_email,
        signer_type,
        status,
        external_recipient_id,
        external_status,
        viewed_at::text,
        signed_at::text
      FROM agreement_signer
      WHERE agreement_id = $1
      ORDER BY signer_order ASC NULLS LAST, created_at ASC
    `,
    [agreementId]
  );
  return rows;
}

async function findAgreementIdByEnvelope(client: PoolClient, externalEnvelopeId: string) {
  if (!externalEnvelopeId) {
    return null;
  }
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id
      FROM agreement
      WHERE external_envelope_id = $1
      LIMIT 1
    `,
    [externalEnvelopeId]
  );
  return rows[0]?.id ?? null;
}

async function applyAgreementProviderSnapshot(client: PoolClient, agreementId: string, snapshot: ProviderLifecycleSnapshot) {
  const agreement = await loadAgreementById(client, agreementId);
  if (!agreement) {
    throw new Error("Agreement not found for provider sync.");
  }

  const occurredAt = snapshot.occurred_at ?? new Date().toISOString();
  const normalizedExternalStatus = normalizeProviderStatus(snapshot.external_status);
  const signerUpdates = snapshot.signer_updates ?? [];

  for (const signerUpdate of signerUpdates) {
    const signer = await resolveSignerForUpdate(client, agreementId, signerUpdate);
    if (!signer) {
      continue;
    }
    const externalStatus = normalizeProviderStatus(signerUpdate.external_status ?? signer.external_status ?? signer.status);
    await client.query(
      `
        UPDATE agreement_signer
        SET
          external_recipient_id = COALESCE($2, external_recipient_id),
          external_status = $3,
          status = $4::agreement_signer_status,
          viewed_at = COALESCE($5::timestamptz, viewed_at),
          signed_at = COALESCE($6::timestamptz, signed_at),
          last_provider_sync_at = $7::timestamptz,
          updated_at = now()
        WHERE id = $1
      `,
      [
        signer.id,
        signerUpdate.external_recipient_id ?? signer.external_recipient_id,
        externalStatus,
        mapSignerStatus(externalStatus, signer.status),
        signerUpdate.viewed_at ?? (externalStatus === "viewed" ? occurredAt : null),
        signerUpdate.signed_at ?? (externalStatus === "signed" ? occurredAt : null),
        occurredAt
      ]
    );
  }

  const refreshedSigners = await loadAgreementSigners(client, agreementId);
  const envelopeStatus = deriveEnvelopeStatus(normalizedExternalStatus, refreshedSigners);
  const nextAgreementStatus = mapAgreementStatus(envelopeStatus, refreshedSigners, agreement.status);
  const nextViewedAt = agreement.viewed_at ?? deriveViewedAt(refreshedSigners, envelopeStatus, occurredAt);
  const nextSignedAt = agreement.signed_at ?? deriveSignedAt(refreshedSigners, envelopeStatus, occurredAt);
  const nextCountersignedAt = agreement.countersigned_at ?? deriveCountersignedAt(refreshedSigners, envelopeStatus, occurredAt);
  const nextSentAt = agreement.sent_at ?? occurredAt;

  await client.query(
    `
      UPDATE agreement
      SET
        external_provider_name = $2,
        external_envelope_id = COALESCE($3, external_envelope_id),
        external_status = $4,
        status = $5::agreement_status,
        sent_at = COALESCE(sent_at, $6::timestamptz),
        viewed_at = COALESCE($7::timestamptz, viewed_at),
        signed_at = COALESCE($8::timestamptz, signed_at),
        countersigned_at = COALESCE($9::timestamptz, countersigned_at),
        last_provider_sync_at = $10::timestamptz,
        provider_error_state = $11,
        provider_metadata = COALESCE(provider_metadata, '{}'::jsonb) || $12::jsonb,
        updated_at = now()
      WHERE id = $1
    `,
    [
      agreementId,
      snapshot.provider_name,
      snapshot.external_envelope_id,
      envelopeStatus,
      nextAgreementStatus,
      nextSentAt,
      nextViewedAt,
      nextSignedAt,
      nextCountersignedAt,
      occurredAt,
      snapshot.provider_error_state ?? null,
      JSON.stringify(snapshot.provider_metadata ?? {})
    ]
  );

  const providerEventType = snapshot.provider_event_type ?? mapProviderEventTypeFromStatus(envelopeStatus);
  await insertAgreementProviderEvent(client, {
    agreementId,
    signerId: null,
    providerName: snapshot.provider_name,
    externalEnvelopeId: snapshot.external_envelope_id,
    direction: "inbound",
    eventType: providerEventType,
    providerStatus: envelopeStatus,
    payload: {
      signer_update_count: signerUpdates.length,
      provider_error_state: snapshot.provider_error_state ?? null
    },
    occurredAt
  });

  await insertAgreementActivityLog(client, {
    agreementId,
    activityType: mapActivityType(providerEventType),
    note: buildActivityNote(providerEventType, agreement.agreement_title),
    metadata: {
      provider_name: snapshot.provider_name,
      external_envelope_id: snapshot.external_envelope_id,
      external_status: envelopeStatus
    }
  });

  if (snapshot.final_documents?.length) {
    await registerProviderFinalDocuments(client, {
      agreementId,
      providerName: snapshot.provider_name,
      externalEnvelopeId: snapshot.external_envelope_id,
      occurredAt,
      documents: snapshot.final_documents
    });
    await insertAgreementProviderEvent(client, {
      agreementId,
      signerId: null,
      providerName: snapshot.provider_name,
      externalEnvelopeId: snapshot.external_envelope_id,
      direction: "inbound",
      eventType: "completed_package_registered",
      providerStatus: envelopeStatus,
      payload: {
        file_count: snapshot.final_documents.length
      },
      occurredAt
    });
  }
}

async function recordAgreementProviderFailure(
  client: PoolClient,
  input: {
    agreementId: string;
    providerName: string;
    externalEnvelopeId?: string | null;
    failureType: "send_failed" | "sync_failed";
    message: string;
  }
) {
  const occurredAt = new Date().toISOString();
  await client.query(
    `
      UPDATE agreement
      SET
        external_provider_name = $2,
        external_envelope_id = COALESCE($3, external_envelope_id),
        external_status = $4,
        last_provider_sync_at = $5::timestamptz,
        provider_error_state = $6,
        updated_at = now()
      WHERE id = $1
    `,
    [input.agreementId, input.providerName, input.externalEnvelopeId ?? null, input.failureType, occurredAt, input.message]
  );
  await insertAgreementProviderEvent(client, {
    agreementId: input.agreementId,
    signerId: null,
    providerName: input.providerName,
    externalEnvelopeId: input.externalEnvelopeId,
    direction: "inbound",
    eventType: input.failureType,
    providerStatus: input.failureType,
    payload: {
      error: input.message
    },
    occurredAt
  });
  await insertAgreementActivityLog(client, {
    agreementId: input.agreementId,
    activityType: input.failureType === "send_failed" ? "provider_send_failed" : "provider_sync_failed",
    note: input.message,
    metadata: {
      provider_name: input.providerName
    }
  });
}

async function resolveSignerForUpdate(client: PoolClient, agreementId: string, update: ProviderSignerSnapshot) {
  if (update.signer_id) {
    const byId = await client.query<{ id: string; external_recipient_id: string | null; external_status: string | null; status: AgreementSignerRow["status"] }>(
      `SELECT id, external_recipient_id, external_status, status FROM agreement_signer WHERE agreement_id = $1 AND id = $2 LIMIT 1`,
      [agreementId, update.signer_id]
    );
    if (byId.rows[0]) {
      return byId.rows[0];
    }
  }
  if (update.external_recipient_id) {
    const byRecipient = await client.query<{ id: string; external_recipient_id: string | null; external_status: string | null; status: AgreementSignerRow["status"] }>(
      `SELECT id, external_recipient_id, external_status, status FROM agreement_signer WHERE agreement_id = $1 AND external_recipient_id = $2 LIMIT 1`,
      [agreementId, update.external_recipient_id]
    );
    if (byRecipient.rows[0]) {
      return byRecipient.rows[0];
    }
  }
  if (update.signer_email) {
    const byEmail = await client.query<{ id: string; external_recipient_id: string | null; external_status: string | null; status: AgreementSignerRow["status"] }>(
      `SELECT id, external_recipient_id, external_status, status FROM agreement_signer WHERE agreement_id = $1 AND lower(signer_email) = lower($2) LIMIT 1`,
      [agreementId, update.signer_email]
    );
    if (byEmail.rows[0]) {
      return byEmail.rows[0];
    }
  }
  return null;
}

function normalizeProviderStatus(value: string | null | undefined) {
  return (value ?? "sent").trim().toLowerCase();
}

function mapSignerStatus(externalStatus: string, currentStatus: AgreementSignerRow["status"]): AgreementSignerRow["status"] {
  if (["signed", "completed", "countersigned"].includes(externalStatus)) {
    return "signed";
  }
  if (externalStatus === "viewed") {
    return currentStatus === "signed" ? currentStatus : "viewed";
  }
  if (["replaced", "cancelled"].includes(externalStatus)) {
    return externalStatus as AgreementSignerRow["status"];
  }
  return currentStatus;
}

function deriveEnvelopeStatus(externalStatus: string, signers: AgreementSignerRow[]) {
  if (["cancelled", "voided", "send_failed", "sync_failed"].includes(externalStatus)) {
    return externalStatus;
  }
  const externalSigners = signers.filter((signer) => signer.signer_type !== "countersigner");
  const countersigners = signers.filter((signer) => signer.signer_type === "countersigner");
  const allExternalSigned = externalSigners.length > 0 && externalSigners.every((signer) => signer.status === "signed");
  const anyViewed = signers.some((signer) => signer.status === "viewed" || Boolean(signer.viewed_at));
  const anySigned = signers.some((signer) => signer.status === "signed" || Boolean(signer.signed_at));
  const allCountersigned = countersigners.length > 0 && countersigners.every((signer) => signer.status === "signed");

  if (allExternalSigned && (countersigners.length === 0 || allCountersigned)) {
    return countersigners.length ? "countersigned" : "signed";
  }
  if (anySigned) {
    return "partially_signed";
  }
  if (anyViewed) {
    return "viewed";
  }
  return externalStatus || "sent";
}

function mapAgreementStatus(externalStatus: string, signers: AgreementSignerRow[], currentStatus: string) {
  if (externalStatus === "viewed") {
    return "viewed";
  }
  if (externalStatus === "partially_signed") {
    return "partially_signed";
  }
  if (externalStatus === "signed") {
    return signers.some((signer) => signer.signer_type === "countersigner") ? "signed" : "signed";
  }
  if (externalStatus === "countersigned") {
    return "countersigned";
  }
  if (externalStatus === "cancelled" || externalStatus === "voided") {
    return "cancelled";
  }
  if (externalStatus === "sent") {
    return currentStatus === "draft" ? "sent" : currentStatus;
  }
  return currentStatus;
}

function deriveViewedAt(signers: AgreementSignerRow[], externalStatus: string, occurredAt: string) {
  const signerViewedAt = signers.map((signer) => signer.viewed_at).find(Boolean);
  if (signerViewedAt) {
    return signerViewedAt;
  }
  return ["viewed", "partially_signed", "signed", "countersigned"].includes(externalStatus) ? occurredAt : null;
}

function deriveSignedAt(signers: AgreementSignerRow[], externalStatus: string, occurredAt: string) {
  const externalSigners = signers.filter((signer) => signer.signer_type !== "countersigner");
  const allExternalSigned = externalSigners.length > 0 && externalSigners.every((signer) => signer.status === "signed" || Boolean(signer.signed_at));
  if (!allExternalSigned) {
    return null;
  }
  return externalSigners.map((signer) => signer.signed_at).find(Boolean) ?? (["signed", "countersigned"].includes(externalStatus) ? occurredAt : null);
}

function deriveCountersignedAt(signers: AgreementSignerRow[], externalStatus: string, occurredAt: string) {
  const countersigners = signers.filter((signer) => signer.signer_type === "countersigner");
  if (!countersigners.length) {
    return externalStatus === "countersigned" ? occurredAt : null;
  }
  const allSigned = countersigners.every((signer) => signer.status === "signed" || Boolean(signer.signed_at));
  if (!allSigned) {
    return null;
  }
  return countersigners.map((signer) => signer.signed_at).find(Boolean) ?? occurredAt;
}

function mapProviderEventTypeFromStatus(status: string): LifecycleEventType {
  switch (normalizeProviderStatus(status)) {
    case "viewed":
      return "viewed";
    case "partially_signed":
      return "sync_updated";
    case "signed":
      return "signed";
    case "countersigned":
      return "countersigned";
    case "cancelled":
      return "cancelled";
    case "voided":
      return "voided";
    case "send_failed":
      return "send_failed";
    case "sync_failed":
      return "sync_failed";
    default:
      return "sync_updated";
  }
}

function mapActivityType(providerEventType: LifecycleEventType) {
  switch (providerEventType) {
    case "sent":
      return "sent_via_provider";
    case "viewed":
      return "provider_viewed";
    case "signed":
      return "provider_signed";
    case "countersigned":
      return "provider_countersigned";
    case "cancelled":
      return "provider_cancelled";
    case "voided":
      return "provider_voided";
    case "send_failed":
      return "provider_send_failed";
    case "sync_failed":
      return "provider_sync_failed";
    default:
      return "provider_sync_updated";
  }
}

function buildActivityNote(providerEventType: LifecycleEventType, agreementTitle: string) {
  switch (providerEventType) {
    case "sent":
      return `Sent ${agreementTitle} to the signature provider.`;
    case "viewed":
      return `${agreementTitle} was viewed through the signature provider.`;
    case "signed":
      return `${agreementTitle} has been signed by the external signer flow.`;
    case "countersigned":
      return `${agreementTitle} has been countersigned and finalized through the provider.`;
    case "cancelled":
      return `${agreementTitle} was cancelled in the provider lifecycle.`;
    case "voided":
      return `${agreementTitle} was voided in the provider lifecycle.`;
    case "send_failed":
      return `Provider send failed for ${agreementTitle}.`;
    case "sync_failed":
      return `Provider sync failed for ${agreementTitle}.`;
    default:
      return `Synchronized ${agreementTitle} with the provider lifecycle.`;
  }
}

async function registerProviderFinalDocuments(
  client: PoolClient,
  input: {
    agreementId: string;
    providerName: string;
    externalEnvelopeId: string;
    occurredAt: string;
    documents: ProviderFinalDocument[];
  }
) {
  for (const document of input.documents) {
    const storageReference =
      document.storage_reference ?? `provider://${input.providerName}/${input.externalEnvelopeId}/${document.version_stage ?? "signed"}/${document.file_name}`;
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM agreement_file WHERE agreement_id = $1 AND storage_reference = $2 LIMIT 1`,
      [input.agreementId, storageReference]
    );
    if (existing.rows[0]) {
      continue;
    }

    const currentVersion = await client.query<{ id: string | null }>(
      `SELECT id FROM agreement_version WHERE agreement_id = $1 AND is_current = true LIMIT 1`,
      [input.agreementId]
    );
    const nextVersionNumberResult = await client.query<{ next_version_number: string | number }>(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version_number FROM agreement_version WHERE agreement_id = $1`,
      [input.agreementId]
    );
    const nextVersionNumber = Number(nextVersionNumberResult.rows[0]?.next_version_number ?? 1);

    await client.query(`UPDATE agreement_version SET is_current = false, updated_at = now() WHERE agreement_id = $1 AND is_current = true`, [
      input.agreementId
    ]);
    await client.query(`UPDATE agreement_file SET is_current = false WHERE agreement_id = $1 AND is_current = true`, [input.agreementId]);

    const versionInsert = await client.query<{ id: string }>(
      `
        INSERT INTO agreement_version (
          tenant_id,
          agreement_id,
          version_number,
          version_label,
          version_stage,
          prior_version_id,
          merge_snapshot,
          is_current,
          created_by_user_id,
          created_at,
          updated_at
        )
        SELECT
          tenant_id,
          id,
          $2,
          $3,
          $4::agreement_version_stage,
          $5,
          $6::jsonb,
          true,
          NULL,
          $7::timestamptz,
          $7::timestamptz
        FROM agreement
        WHERE id = $1
        RETURNING id
      `,
      [
        input.agreementId,
        nextVersionNumber,
        document.version_label ?? (document.version_stage === "countersigned_final" ? "Countersigned Final" : "Signed Final"),
        document.version_stage ?? "signed",
        currentVersion.rows[0]?.id ?? null,
        JSON.stringify({
          provider_name: input.providerName,
          external_envelope_id: input.externalEnvelopeId
        }),
        input.occurredAt
      ]
    );

    await client.query(
      `
        INSERT INTO agreement_file (
          tenant_id,
          agreement_id,
          agreement_version_id,
          file_type,
          file_name,
          storage_reference,
          file_url,
          content_type,
          version_label,
          is_current,
          uploaded_by_user_id,
          uploaded_at
        )
        SELECT
          tenant_id,
          id,
          $2,
          'pdf'::agreement_file_type,
          $3,
          $4,
          $5,
          $6,
          $7,
          true,
          NULL,
          $8::timestamptz
        FROM agreement
        WHERE id = $1
      `,
      [
        input.agreementId,
        versionInsert.rows[0].id,
        document.file_name,
        storageReference,
        document.file_url ?? null,
        document.content_type ?? "application/pdf",
        document.version_label ?? (document.version_stage === "countersigned_final" ? "Countersigned Final" : "Signed Final"),
        input.occurredAt
      ]
    );

    await insertAgreementActivityLog(client, {
      agreementId: input.agreementId,
      activityType: "final_signed_file_registered",
      note: `Registered ${document.version_stage === "countersigned_final" ? "the countersigned final package" : "the signed package"} from the provider.`,
      metadata: {
        provider_name: input.providerName,
        external_envelope_id: input.externalEnvelopeId,
        storage_reference: storageReference
      }
    });
  }
}

async function insertAgreementProviderEvent(
  client: PoolClient,
  input: {
    agreementId: string;
    signerId?: string | null;
    providerName: string;
    externalEnvelopeId?: string | null;
    externalRecipientId?: string | null;
    direction: "outbound" | "inbound";
    eventType:
      | "send_requested"
      | "sent"
      | "reminder_requested"
      | "reminder_sent"
      | "sync_requested"
      | "sync_updated"
      | "viewed"
      | "signed"
      | "countersigned"
      | "completed_package_registered"
      | "voided"
      | "cancelled"
      | "send_failed"
      | "sync_failed";
    providerStatus?: string | null;
    payload?: Record<string, unknown>;
    occurredAt?: string | null;
  }
) {
  await client.query(
    `
      INSERT INTO agreement_provider_event (
        tenant_id,
        agreement_id,
        signer_id,
        provider_name,
        external_envelope_id,
        external_recipient_id,
        direction,
        event_type,
        provider_status,
        payload,
        occurred_at
      )
      SELECT
        tenant_id,
        id,
        $2,
        $3,
        $4,
        $5,
        $6::agreement_provider_event_direction,
        $7::agreement_provider_event_type,
        $8,
        $9::jsonb,
        COALESCE($10::timestamptz, now())
      FROM agreement
      WHERE id = $1
    `,
    [
      input.agreementId,
      input.signerId ?? null,
      input.providerName,
      input.externalEnvelopeId ?? null,
      input.externalRecipientId ?? null,
      input.direction,
      input.eventType,
      input.providerStatus ?? null,
      JSON.stringify(input.payload ?? {}),
      input.occurredAt ?? null
    ]
  );
}

async function insertAgreementActivityLog(
  client: PoolClient,
  input: {
    agreementId: string;
    activityType:
      | "sent_via_provider"
      | "provider_sync_updated"
      | "provider_send_failed"
      | "provider_sync_failed"
      | "provider_viewed"
      | "provider_signed"
      | "provider_countersigned"
      | "provider_voided"
      | "provider_cancelled"
      | "provider_reminder_sent"
      | "final_signed_file_registered";
    note: string;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO agreement_activity_log (
        tenant_id,
        agreement_id,
        activity_type,
        actor_id,
        actor_role,
        note,
        metadata
      )
      SELECT
        tenant_id,
        id,
        $2::agreement_activity_type,
        NULL,
        'provider_integration',
        $3,
        $4::jsonb
      FROM agreement
      WHERE id = $1
    `,
    [input.agreementId, input.activityType, input.note, JSON.stringify(input.metadata ?? {})]
  );
}

function normalizeRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
