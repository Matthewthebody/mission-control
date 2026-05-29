import { useEffect, useState } from "react";
import type { ResourceLibraryCategory } from "../types";
import type {
  RecordResourceItem,
  RecordResourceObjectType,
  RecordResourcesResponse
} from "../recordResourcesTypes";
import {
  createRecordResource,
  deleteRecordResource,
  listRecordResources,
  uploadRecordResourceFile
} from "../services/recordResourcesApi";

type Props = {
  token: string;
  objectType: RecordResourceObjectType;
  objectId: string;
  title?: string;
  summary?: string;
};

type CreateMode = "link" | "upload" | null;

type LinkFormState = {
  title: string;
  category: ResourceLibraryCategory;
  description: string;
  url: string;
};

type UploadFormState = {
  title: string;
  category: ResourceLibraryCategory;
  description: string;
  file: File | null;
};

const CATEGORY_OPTIONS: Array<{ value: ResourceLibraryCategory; label: string }> = [
  { value: "sop_reference", label: "SOP / Reference" },
  { value: "contract_document", label: "Contract / Agreement" },
  { value: "proof_document", label: "Proof / Review Document" },
  { value: "support_document", label: "Support Document" },
  { value: "setup_photo", label: "Setup Photo" },
  { value: "location_reference", label: "Location Reference" },
  { value: "prior_successful_example", label: "Prior Successful Example" },
  { value: "product_example", label: "Product Example" },
  { value: "issue_concern", label: "Issue / Concern" },
  { value: "equipment_setup_need", label: "Equipment / Setup Need" },
  { value: "qr_code_job_document", label: "QR / Job Document" },
  { value: "misc_internal_reference", label: "Misc Internal Reference" }
];

const DEFAULT_LINK_FORM: LinkFormState = {
  title: "",
  category: "support_document",
  description: "",
  url: ""
};

const DEFAULT_UPLOAD_FORM: UploadFormState = {
  title: "",
  category: "support_document",
  description: "",
  file: null
};

export function RecordResourcesPanel({
  token,
  objectType,
  objectId,
  title = "Resources",
  summary = "Attach SOPs, support files, proofs, references, or external links that help the team work this record."
}: Props) {
  const [data, setData] = useState<RecordResourcesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [saving, setSaving] = useState(false);
  const [linkForm, setLinkForm] = useState<LinkFormState>(DEFAULT_LINK_FORM);
  const [uploadForm, setUploadForm] = useState<UploadFormState>(DEFAULT_UPLOAD_FORM);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listRecordResources(token, objectType, objectId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setData(response);
        setError("");
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setData(null);
        setError(loadError instanceof Error ? loadError.message : "We couldn't load resources right now.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [objectId, objectType, token]);

  async function refresh() {
    const response = await listRecordResources(token, objectType, objectId);
    setData(response);
    setError("");
    return response;
  }

  async function handleCreateLink() {
    if (!linkForm.title.trim() || !linkForm.url.trim()) {
      setError("Add a title and URL before saving this link.");
      return;
    }
    setSaving(true);
    try {
      await createRecordResource(token, objectType, objectId, {
        title: linkForm.title.trim(),
        category: linkForm.category,
        description: linkForm.description.trim() || null,
        url: linkForm.url.trim()
      });
      await refresh();
      setCreateMode(null);
      setLinkForm(DEFAULT_LINK_FORM);
      setNotice("Link added.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn't save that link.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateUpload() {
    if (!uploadForm.file) {
      setError("Choose a file before uploading.");
      return;
    }
    const resolvedTitle = uploadForm.title.trim() || uploadForm.file.name;
    setSaving(true);
    try {
      const upload = await uploadRecordResourceFile(token, uploadForm.file, objectType, objectId);
      await createRecordResource(token, objectType, objectId, {
        title: resolvedTitle,
        category: uploadForm.category,
        description: uploadForm.description.trim() || null,
        storage_key: upload.storage_key,
        url: upload.url,
        content_type: upload.content_type,
        file_size_bytes: upload.file_size_bytes
      });
      await refresh();
      setCreateMode(null);
      setUploadForm(DEFAULT_UPLOAD_FORM);
      setNotice("File uploaded.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn't upload that file.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(item: RecordResourceItem) {
    if (!item.can_remove) {
      return;
    }
    if (!window.confirm(`Remove "${item.title}" from this record?`)) {
      return;
    }
    setSaving(true);
    try {
      await deleteRecordResource(token, objectType, objectId, item.id);
      await refresh();
      setNotice("Resource removed.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "We couldn't remove that resource.");
    } finally {
      setSaving(false);
    }
  }

  const canManage = Boolean(data?.access.can_manage);

  return (
    <section className="request-card record-resources-panel">
      <div className="directory-card__header">
        <div>
          <strong>{title}</strong>
          <div className="muted">{summary}</div>
        </div>
        {canManage ? (
          <div className="page-intro-actions page-intro-actions--compact">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setCreateMode("link");
                setNotice("");
                setError("");
              }}
            >
              Add link
            </button>
            <button
              type="button"
              onClick={() => {
                setCreateMode("upload");
                setNotice("");
                setError("");
              }}
            >
              Upload file
            </button>
          </div>
        ) : null}
      </div>

      {data ? (
        <div className="record-resources-panel__summary">
          <span className="meta-pill">{data.summary.total_items} total</span>
          <span className="meta-pill">{data.summary.uploaded_file_count} uploads</span>
          <span className="meta-pill">{data.summary.external_link_count} links</span>
          <span className="meta-pill">{data.object.label}</span>
        </div>
      ) : null}

      {notice ? (
        <div className="feedback-strip feedback-strip--success">
          <div className="feedback-strip__content">{notice}</div>
        </div>
      ) : null}
      {error ? (
        <div className="feedback-strip feedback-strip--warning">
          <div className="feedback-strip__content">{error}</div>
        </div>
      ) : null}

      {createMode === "link" ? (
        <div className="record-resources-panel__form">
          <div className="field-grid">
            <label className="filter-field">
              <span>Title</span>
              <input value={linkForm.title} onChange={(event) => setLinkForm((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label className="filter-field">
              <span>Category</span>
              <select value={linkForm.category} onChange={(event) => setLinkForm((current) => ({ ...current, category: event.target.value as ResourceLibraryCategory }))}>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>URL</span>
              <input value={linkForm.url} onChange={(event) => setLinkForm((current) => ({ ...current, url: event.target.value }))} />
            </label>
            <label className="filter-field">
              <span>Description</span>
              <textarea value={linkForm.description} onChange={(event) => setLinkForm((current) => ({ ...current, description: event.target.value }))} rows={3} />
            </label>
          </div>
          <div className="page-intro-actions page-intro-actions--compact">
            <button type="button" onClick={() => void handleCreateLink()} disabled={saving}>
              {saving ? "Saving..." : "Save link"}
            </button>
            <button type="button" className="secondary-button" onClick={() => setCreateMode(null)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {createMode === "upload" ? (
        <div className="record-resources-panel__form">
          <div className="field-grid">
            <label className="filter-field">
              <span>File</span>
              <input
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setUploadForm((current) => ({
                    ...current,
                    file,
                    title: current.title || file?.name || ""
                  }));
                }}
              />
            </label>
            <label className="filter-field">
              <span>Title</span>
              <input value={uploadForm.title} onChange={(event) => setUploadForm((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label className="filter-field">
              <span>Category</span>
              <select value={uploadForm.category} onChange={(event) => setUploadForm((current) => ({ ...current, category: event.target.value as ResourceLibraryCategory }))}>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Description</span>
              <textarea value={uploadForm.description} onChange={(event) => setUploadForm((current) => ({ ...current, description: event.target.value }))} rows={3} />
            </label>
          </div>
          <div className="page-intro-actions page-intro-actions--compact">
            <button type="button" onClick={() => void handleCreateUpload()} disabled={saving}>
              {saving ? "Uploading..." : "Upload"}
            </button>
            <button type="button" className="secondary-button" onClick={() => setCreateMode(null)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="empty-state empty-state--panel">Loading attached resources...</div>
      ) : data && data.items.length ? (
        <div className="record-resources-panel__list">
          {data.items.map((item) => (
            <article key={item.id} className="record-resources-panel__item">
              <div className="record-resources-panel__item-header">
                <div>
                  <strong>{item.title}</strong>
                  <div className="muted">
                    {labelForCategory(item.category)} | {labelForProvider(item.provider, item.reference_kind)}
                  </div>
                </div>
                <div className="page-intro-actions page-intro-actions--compact">
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer" className="secondary-button">
                      Open
                    </a>
                  ) : null}
                  {item.can_remove ? (
                    <button type="button" className="secondary-button" onClick={() => void handleRemove(item)} disabled={saving}>
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="record-resources-panel__meta">
                <span className="meta-pill">{item.resource_type}</span>
                {item.content_type ? <span className="meta-pill">{item.content_type}</span> : null}
                {item.file_size_bytes ? <span className="meta-pill">{formatFileSize(item.file_size_bytes)}</span> : null}
                <span className="meta-pill">Added {formatDateLabel(item.created_at)}</span>
                <span className="meta-pill">{item.uploaded_by_name ?? "Unknown uploader"}</span>
              </div>
              {item.description ? <p className="muted">{item.description}</p> : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state empty-state--panel">
          No resources are attached yet. Add files or links that help the team work this record.
        </div>
      )}
    </section>
  );
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function labelForCategory(category: ResourceLibraryCategory) {
  return CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? category;
}

function labelForProvider(provider: RecordResourceItem["provider"], referenceKind: RecordResourceItem["reference_kind"]) {
  if (referenceKind === "uploaded_file") {
    return "Uploaded file";
  }
  if (provider === "sharepoint") {
    return "SharePoint link";
  }
  if (provider === "onedrive") {
    return "OneDrive link";
  }
  return "External link";
}
