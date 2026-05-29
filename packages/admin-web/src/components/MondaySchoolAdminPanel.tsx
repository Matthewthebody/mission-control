import { useEffect, useState } from "react";
import {
  getSchoolsHubReferenceData,
  importMondaySchoolSnapshotRecord,
  reimportMondaySchoolEntityRecord
} from "../services/schoolsHubApi";
import type {
  MondayImportMode,
  MondaySchoolImportInput,
  SchoolJobType,
  SchoolWorkPriority,
  SchoolsHubReferenceData,
  SchoolWorkType,
  SchoolWorkWaitingOn
} from "../schoolsHubTypes";

type Props = {
  token: string;
  initialEntityType?: "school_job" | "school_work_item";
  initialEntityId?: string | null;
  onCompleted?: () => void;
};

type MondayImportDraft = {
  organization_id: string;
  import_mode: MondayImportMode;
  external_record_id: string;
  external_record_name: string;
  external_board_name: string;
  external_record_url: string;
  existing_school_job_id: string;
  job_type: SchoolJobType;
  work_type: SchoolWorkType;
  owner_user_id: string;
  due_date: string;
  waiting_on: SchoolWorkWaitingOn;
  priority: SchoolWorkPriority;
  notes: string;
};

const WORK_TYPE_OPTIONS: Array<{ value: SchoolWorkType; label: string }> = [
  { value: "pre_shoot_coordination", label: "Pre-Shoot Coordination" },
  { value: "gallery_release", label: "Gallery Release" },
  { value: "id_production", label: "ID Production" },
  { value: "admin_item", label: "Admin Item" },
  { value: "yearbook", label: "Yearbook" },
  { value: "graduation", label: "Graduation" },
  { value: "delivery", label: "Delivery" },
  { value: "invoicing", label: "Invoicing" },
  { value: "follow_up", label: "Follow-Up" },
  { value: "exception_handling", label: "Exception Handling" }
];

const PRIORITY_OPTIONS: Array<{ value: SchoolWorkPriority; label: string }> = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" }
];

const WAITING_ON_OPTIONS: Array<{ value: SchoolWorkWaitingOn; label: string }> = [
  { value: "none", label: "Not Waiting" },
  { value: "school", label: "School" },
  { value: "internal_production", label: "Internal Production" },
  { value: "internal_ops", label: "Internal Ops" },
  { value: "shipping_vendor", label: "Shipping Vendor" },
  { value: "billing", label: "Billing" },
  { value: "other", label: "Other" }
];

const JOB_TYPE_OPTIONS: Array<{ value: SchoolJobType; label: string }> = [
  { value: "fall_portraits", label: "Fall Portraits" },
  { value: "retakes", label: "Retakes" },
  { value: "spring_portraits", label: "Spring Portraits" },
  { value: "sports", label: "Sports" },
  { value: "graduation", label: "Graduation" },
  { value: "yearbook", label: "Yearbook" },
  { value: "ids", label: "IDs" },
  { value: "admin_fulfillment", label: "Admin Fulfillment" },
  { value: "delivery", label: "Delivery" },
  { value: "other", label: "Other" }
];

export function MondaySchoolAdminPanel({ token, initialEntityType = "school_work_item", initialEntityId = null, onCompleted }: Props) {
  const [references, setReferences] = useState<SchoolsHubReferenceData | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [importingMonday, setImportingMonday] = useState(false);
  const [reimportingMonday, setReimportingMonday] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reimportEntityType, setReimportEntityType] = useState<"school_job" | "school_work_item">(initialEntityType);
  const [reimportEntityId, setReimportEntityId] = useState(initialEntityId ?? "");
  const [draft, setDraft] = useState<MondayImportDraft>({
    organization_id: "",
    import_mode: "job_and_work_item",
    external_record_id: "",
    external_record_name: "",
    external_board_name: "",
    external_record_url: "",
    existing_school_job_id: "",
    job_type: "other",
    work_type: "follow_up",
    owner_user_id: "",
    due_date: "",
    waiting_on: "none",
    priority: "normal",
    notes: ""
  });

  useEffect(() => {
    setReimportEntityType(initialEntityType);
    setReimportEntityId(initialEntityId ?? "");
  }, [initialEntityId, initialEntityType]);

  useEffect(() => {
    let active = true;
    setReferenceLoading(true);
    void getSchoolsHubReferenceData(token)
      .then((payload) => {
        if (!active) {
          return;
        }
        setReferences(payload);
        setError("");
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "We couldn't load Schools integration reference data.");
      })
      .finally(() => {
        if (active) {
          setReferenceLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function handleMondayImport() {
    if (!draft.organization_id || !draft.external_record_id.trim() || !draft.external_record_name.trim()) {
      setError("Choose a school, a Monday item ID, and an item title before importing.");
      return;
    }

    const payload: MondaySchoolImportInput = {
      organization_id: draft.organization_id,
      import_mode: draft.import_mode,
      external_record_id: draft.external_record_id.trim(),
      external_record_name: draft.external_record_name.trim(),
      external_board_name: draft.external_board_name.trim() || null,
      external_record_url: draft.external_record_url.trim() || null,
      existing_school_job_id: draft.existing_school_job_id || null,
      mapped_job:
        draft.import_mode === "work_item"
          ? null
          : {
              job_type: draft.job_type,
              title: draft.external_record_name.trim(),
              due_date: draft.due_date || null,
              owner_user_id: draft.owner_user_id || null,
              status: "active",
              notes: draft.notes.trim() || null
            },
      mapped_work_item:
        draft.import_mode === "job"
          ? null
          : {
              work_type: draft.work_type,
              title: draft.external_record_name.trim(),
              owner_user_id: draft.owner_user_id || null,
              status: "open",
              stage:
                draft.waiting_on === "school"
                  ? "waiting_on_school"
                  : draft.waiting_on === "internal_production"
                    ? "waiting_on_internal"
                    : "planning",
              priority: draft.priority,
              due_date: draft.due_date || null,
              waiting_on: draft.waiting_on,
              notes: draft.notes.trim() || null
            }
    };

    setImportingMonday(true);
    setError("");
    setNotice("");
    try {
      const result = await importMondaySchoolSnapshotRecord(token, payload);
      const importedTitle = result.imported_work_item?.title ?? result.imported_job?.title ?? "Monday record";
      setNotice(`${importedTitle} imported with Monday source attribution.`);
      setDraft((current) => ({
        ...current,
        external_record_id: "",
        external_record_name: "",
        external_record_url: "",
        notes: ""
      }));
      onCompleted?.();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "We couldn't import that Monday item right now.");
    } finally {
      setImportingMonday(false);
    }
  }

  async function handleReimport() {
    if (!reimportEntityId.trim()) {
      setError("Enter the local record ID to re-import from stored Monday attribution.");
      return;
    }
    setReimportingMonday(true);
    setError("");
    setNotice("");
    try {
      const result = await reimportMondaySchoolEntityRecord(token, reimportEntityType, reimportEntityId.trim());
      const refreshedTitle =
        result.imported_work_item?.title ?? result.imported_job?.title ?? "Monday-linked record";
      setNotice(`${refreshedTitle} re-imported from the stored Monday snapshot.`);
      onCompleted?.();
    } catch (reimportError) {
      setError(reimportError instanceof Error ? reimportError.message : "We couldn't re-import that Monday-linked record right now.");
    } finally {
      setReimportingMonday(false);
    }
  }

  return (
    <section className="panel dashboard-panel monday-admin-panel">
      <div className="dashboard-panel__header">
        <div>
          <div className="section-title">Monday Coexistence Controls</div>
          <p className="section-subtitle">Operational pages keep source attribution visible. Import, replay, and coexistence controls live here under Admin Integrations.</p>
        </div>
        <div className="page-intro-actions page-intro-actions--compact">
          <span className="metric-pill">Admin only</span>
          <span className="metric-pill">No runtime source-of-truth handoff</span>
        </div>
      </div>

      {notice ? <div className="feedback-strip feedback-strip--success">{notice}</div> : null}
      {error ? <div className="feedback-strip feedback-strip--danger">{error}</div> : null}

      <div className="monday-admin-panel__grid">
        <section className="monday-admin-panel__section">
          <div className="eyebrow">Import Snapshot</div>
          <h3>Bring a Monday record into native school work</h3>
          <p className="muted">This is an import tool, not a live sync surface. Mission Control stays primary after import.</p>
          {referenceLoading ? <div className="empty-state">Loading Schools reference data...</div> : null}
          <div className="form-grid form-grid--compact">
            <label className="filter-field">
              <span>Import School</span>
              <select value={draft.organization_id} onChange={(event) => setDraft((current) => ({ ...current, organization_id: event.target.value }))}>
                <option value="">Choose school</option>
                {(references?.schools ?? []).map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Import Mode</span>
              <select value={draft.import_mode} onChange={(event) => setDraft((current) => ({ ...current, import_mode: event.target.value as MondayImportMode }))}>
                <option value="job_and_work_item">Job + Work Item</option>
                <option value="job">Job Only</option>
                <option value="work_item">Work Item Only</option>
              </select>
            </label>
            <label className="filter-field">
              <span>Monday Item ID</span>
              <input value={draft.external_record_id} onChange={(event) => setDraft((current) => ({ ...current, external_record_id: event.target.value }))} placeholder="e.g. 123456789" />
            </label>
            <label className="filter-field filter-field--wide">
              <span>Monday Item Title</span>
              <input value={draft.external_record_name} onChange={(event) => setDraft((current) => ({ ...current, external_record_name: event.target.value }))} placeholder="Imported title shown in Mission Control" />
            </label>
            <label className="filter-field">
              <span>Board</span>
              <input value={draft.external_board_name} onChange={(event) => setDraft((current) => ({ ...current, external_board_name: event.target.value }))} placeholder="Optional board name" />
            </label>
            <label className="filter-field">
              <span>Owner</span>
              <select value={draft.owner_user_id} onChange={(event) => setDraft((current) => ({ ...current, owner_user_id: event.target.value }))}>
                <option value="">Leave unassigned</option>
                {(references?.owners ?? []).map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.label}
                  </option>
                ))}
              </select>
            </label>
            {draft.import_mode === "work_item" ? (
              <label className="filter-field">
                <span>Link To Existing Job</span>
                <select value={draft.existing_school_job_id} onChange={(event) => setDraft((current) => ({ ...current, existing_school_job_id: event.target.value }))}>
                  <option value="">Optional</option>
                  {(references?.jobs ?? []).map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="filter-field">
                <span>Job Type</span>
                <select value={draft.job_type} onChange={(event) => setDraft((current) => ({ ...current, job_type: event.target.value as SchoolJobType }))}>
                  {JOB_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {draft.import_mode !== "job" ? (
              <label className="filter-field">
                <span>Work Type</span>
                <select value={draft.work_type} onChange={(event) => setDraft((current) => ({ ...current, work_type: event.target.value as SchoolWorkType }))}>
                  {WORK_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="filter-field">
              <span>Due Date</span>
              <input type="date" value={draft.due_date} onChange={(event) => setDraft((current) => ({ ...current, due_date: event.target.value }))} />
            </label>
            <label className="filter-field">
              <span>Waiting On</span>
              <select value={draft.waiting_on} onChange={(event) => setDraft((current) => ({ ...current, waiting_on: event.target.value as SchoolWorkWaitingOn }))}>
                {WAITING_ON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Priority</span>
              <select value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as SchoolWorkPriority }))}>
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field filter-field--wide">
              <span>Monday URL</span>
              <input value={draft.external_record_url} onChange={(event) => setDraft((current) => ({ ...current, external_record_url: event.target.value }))} placeholder="Optional direct Monday item URL" />
            </label>
            <label className="filter-field filter-field--wide">
              <span>Import Notes</span>
              <textarea rows={3} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional board context or migration notes to keep with the imported record" />
            </label>
          </div>
          <div className="page-intro-actions page-intro-actions--compact">
            <button type="button" className="secondary-button" onClick={() => void handleMondayImport()} disabled={importingMonday || referenceLoading}>
              {importingMonday ? "Importing..." : "Import Monday Snapshot"}
            </button>
          </div>
        </section>

        <section className="monday-admin-panel__section">
          <div className="eyebrow">Re-Import Existing Record</div>
          <h3>Replay stored Monday attribution safely</h3>
          <p className="muted">Use the local record ID from a school job or work item when the imported snapshot needs a controlled replay.</p>
          <div className="form-grid form-grid--compact">
            <label className="filter-field">
              <span>Entity Type</span>
              <select value={reimportEntityType} onChange={(event) => setReimportEntityType(event.target.value as "school_job" | "school_work_item")}>
                <option value="school_work_item">School Work Item</option>
                <option value="school_job">School Job</option>
              </select>
            </label>
            <label className="filter-field filter-field--wide">
              <span>Local Record ID</span>
              <input value={reimportEntityId} onChange={(event) => setReimportEntityId(event.target.value)} placeholder="UUID from the native Mission Control record" />
            </label>
          </div>
          <div className="page-intro-actions page-intro-actions--compact">
            <button type="button" className="secondary-button" onClick={() => void handleReimport()} disabled={reimportingMonday}>
              {reimportingMonday ? "Re-importing..." : "Re-Import Existing Record"}
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}
