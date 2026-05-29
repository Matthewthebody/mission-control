import { useEffect, useMemo, useState } from "react";
import {
  createBackgroundPack,
  createBackgroundVariant,
  createPresetVersion,
  createProductionPreset,
  createToolLicense,
  getProductionAssetWorkspace,
  updateBackgroundPack,
  updateBackgroundVariant,
  updatePresetVersion,
  updateProductionPreset,
  updateToolLicense
} from "../services/productionAssetsApi";
import type {
  ProductionAssetJobType,
  ProductionAssetLicenseStatus,
  ProductionAssetLicenseType,
  ProductionAssetPreset,
  ProductionAssetPresetVersion,
  ProductionAssetValidationStatus,
  ProductionAssetWorkspace,
  ProductionBackgroundPack,
  ProductionBackgroundVariant,
  ProductionToolLicense,
  SessionUser
} from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type TabKey = "presets" | "backgrounds" | "licenses";

const TAB_OPTIONS: Array<{ key: TabKey; label: string; summary: string }> = [
  { key: "presets", label: "Presets", summary: "Editing presets and their versions used across graphics workflows." },
  { key: "backgrounds", label: "Background Packs", summary: "Managed background packs and variants tied to graphics jobs." },
  { key: "licenses", label: "Tool Licenses", summary: "Plugin, license, and seat tracking for graphics tooling." }
];

const JOB_TYPE_OPTIONS: Array<{ value: ProductionAssetJobType; label: string }> = [
  { value: "standard_school_production", label: "Standard School Production" },
  { value: "sports_production", label: "Sports Production" },
  { value: "specialty_graphics", label: "Specialty Graphics" },
  { value: "banner_specialty_product", label: "Banner Specialty Product" },
  { value: "gallery_prep_upload", label: "Gallery Prep / Upload" },
  { value: "qa_final_review", label: "QA Final Review" },
  { value: "correction_rework", label: "Correction / Rework" }
];

const VALIDATION_OPTIONS: Array<{ value: ProductionAssetValidationStatus; label: string }> = [
  { value: "unvalidated", label: "Unvalidated" },
  { value: "validated", label: "Validated" },
  { value: "deprecated", label: "Deprecated" }
];

const LICENSE_STATUS_OPTIONS: Array<{ value: ProductionAssetLicenseStatus; label: string }> = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "expiring", label: "Expiring Soon" },
  { value: "expired", label: "Expired" }
];

const LICENSE_TYPE_OPTIONS: Array<{ value: ProductionAssetLicenseType; label: string }> = [
  { value: "subscription", label: "Subscription" },
  { value: "perpetual", label: "Perpetual" },
  { value: "floating", label: "Floating" },
  { value: "device", label: "Device" },
  { value: "seat", label: "Seat" },
  { value: "other", label: "Other" }
];

export function ProductionAssetsPage({ token, currentUser }: Props) {
  const [workspace, setWorkspace] = useState<ProductionAssetWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("presets");
  const [search, setSearch] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [selectedLicenseId, setSelectedLicenseId] = useState<string | null>(null);
  const [presetDraft, setPresetDraft] = useState<ProductionAssetPreset | null>(null);
  const [packDraft, setPackDraft] = useState<ProductionBackgroundPack | null>(null);
  const [licenseDraft, setLicenseDraft] = useState<ProductionToolLicense | null>(null);
  const [creatingPreset, setCreatingPreset] = useState(false);
  const [creatingPack, setCreatingPack] = useState(false);
  const [creatingLicense, setCreatingLicense] = useState(false);
  const [creatingVariantForPack, setCreatingVariantForPack] = useState(false);
  const [creatingVersionForPreset, setCreatingVersionForPreset] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");

  useEffect(() => {
    reloadWorkspace();
  }, []);

  useEffect(() => {
    if (!workspace) {
      return;
    }
    if (!selectedPresetId && workspace.presets.length) {
      setSelectedPresetId(workspace.presets[0].id);
    }
    if (!selectedPackId && workspace.background_packs.length) {
      setSelectedPackId(workspace.background_packs[0].id);
    }
    if (!selectedLicenseId && workspace.licenses.length) {
      setSelectedLicenseId(workspace.licenses[0].id);
    }
  }, [workspace, selectedPresetId, selectedPackId, selectedLicenseId]);

  const filteredPresets = useMemo(
    () => filterBySearch(workspace?.presets ?? [], search, (item) => [item.name, item.description, item.notes]),
    [workspace?.presets, search]
  );
  const filteredPacks = useMemo(
    () => filterBySearch(workspace?.background_packs ?? [], search, (item) => [item.name, item.description, item.notes]),
    [workspace?.background_packs, search]
  );
  const filteredLicenses = useMemo(
    () => filterBySearch(workspace?.licenses ?? [], search, (item) => [item.tool_name, item.notes, item.restrictions]),
    [workspace?.licenses, search]
  );

  const selectedPreset = filteredPresets.find((preset) => preset.id === selectedPresetId) ?? null;
  const selectedPack = filteredPacks.find((pack) => pack.id === selectedPackId) ?? null;
  const selectedLicense = filteredLicenses.find((license) => license.id === selectedLicenseId) ?? null;

  useEffect(() => {
    setPresetDraft(selectedPreset ? { ...selectedPreset } : null);
  }, [selectedPresetId, selectedPreset]);

  useEffect(() => {
    setPackDraft(selectedPack ? { ...selectedPack } : null);
  }, [selectedPackId, selectedPack]);

  useEffect(() => {
    setLicenseDraft(selectedLicense ? { ...selectedLicense } : null);
  }, [selectedLicenseId, selectedLicense]);

  function reloadWorkspace() {
    setLoading(true);
    void getProductionAssetWorkspace(token)
      .then((payload) => {
        setWorkspace(payload);
        setError("");
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "We couldn't load graphics assets right now.");
      })
      .finally(() => setLoading(false));
  }

  const summary = buildSummary(workspace);

  return (
    <div className="workspace-shell production-assets">
      <section className="page-intro page-intro--workspace panel">
        <div className="page-intro__body">
          <div className="eyebrow">Graphics</div>
          <h2>Graphics Asset Manager</h2>
          <p>Presets, background packs, and graphics tool licenses tracked in one place.</p>
        </div>
        <div className="page-intro-actions page-intro-actions--compact">
          <div className="metric-pill">Viewer: {currentUser.fullName}</div>
          <button type="button" className="secondary-button" onClick={reloadWorkspace}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="panel production-assets__summary">
        <div className="production-assets__summary-grid">
          <article className="request-card">
            <span className="eyebrow">Presets</span>
            <strong>{summary.activePresets}</strong>
            <div className="muted">{summary.validatedPresets} validated</div>
          </article>
          <article className="request-card">
            <span className="eyebrow">Background Packs</span>
            <strong>{summary.activeBackgroundPacks}</strong>
            <div className="muted">{summary.validatedBackgroundPacks} validated</div>
          </article>
          <article className="request-card">
            <span className="eyebrow">Tool Licenses</span>
            <strong>{summary.activeLicenses}</strong>
            <div className="muted">{summary.expiringLicenses} expiring soon</div>
          </article>
        </div>
      </section>

      <section className="panel production-assets__toolbar">
        <div className="report-tab-row" role="tablist" aria-label="Graphics asset manager tabs">
          {TAB_OPTIONS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={activeTab === tab.key ? "is-active" : ""}
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <label className="filter-field production-assets__search">
          <span>Search</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search presets, backgrounds, or licenses" />
        </label>
        {saveNotice ? <div className="live-banner">{saveNotice}</div> : null}
      </section>

      {loading && !workspace ? (
        <section className="panel loading-panel">
          <div className="section-title">Loading graphics assets</div>
          <p className="section-subtitle">Gathering presets, backgrounds, and tool license metadata.</p>
        </section>
      ) : null}

      {!workspace ? null : (
        <section className="production-assets__layout">
          <div className="production-assets__list panel">
            <div className="production-assets__list-header">
              <div>
                <div className="section-title">{TAB_OPTIONS.find((tab) => tab.key === activeTab)?.label}</div>
                <p className="section-subtitle">{TAB_OPTIONS.find((tab) => tab.key === activeTab)?.summary}</p>
              </div>
              {activeTab === "presets" ? (
                <button type="button" className="primary-button" onClick={() => setCreatingPreset(true)}>
                  Add Preset
                </button>
              ) : null}
              {activeTab === "backgrounds" ? (
                <button type="button" className="primary-button" onClick={() => setCreatingPack(true)}>
                  Add Background Pack
                </button>
              ) : null}
              {activeTab === "licenses" ? (
                <button type="button" className="primary-button" onClick={() => setCreatingLicense(true)}>
                  Add License
                </button>
              ) : null}
            </div>

            {activeTab === "presets" ? (
              <>
                {creatingPreset ? (
                  <PresetCreateForm
                    onCancel={() => setCreatingPreset(false)}
                    onCreate={(payload) => {
                      void createProductionPreset(token, payload).then(() => {
                        setCreatingPreset(false);
                        setSaveNotice("Preset created.");
                        reloadWorkspace();
                      });
                    }}
                  />
                ) : null}
                {filteredPresets.length ? (
                  <div className="production-assets__cards">
                    {filteredPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className={`production-assets__card${preset.id === selectedPresetId ? " is-active" : ""}`}
                        onClick={() => setSelectedPresetId(preset.id)}
                      >
                        <div>
                          <strong>{preset.name}</strong>
                          <div className="muted">{preset.description ?? "No description yet."}</div>
                        </div>
                        <div className="production-assets__card-meta">
                          <span className={`meta-pill meta-pill--${preset.active_status ? "success" : "warning"}`}>
                            {preset.active_status ? "Active" : "Inactive"}
                          </span>
                          <span className="meta-pill">{humanize(preset.validation_status)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state empty-state--panel">No presets match this search yet.</div>
                )}
              </>
            ) : null}

            {activeTab === "backgrounds" ? (
              <>
                {creatingPack ? (
                  <BackgroundPackCreateForm
                    onCancel={() => setCreatingPack(false)}
                    onCreate={(payload) => {
                      void createBackgroundPack(token, payload).then(() => {
                        setCreatingPack(false);
                        setSaveNotice("Background pack created.");
                        reloadWorkspace();
                      });
                    }}
                  />
                ) : null}
                {filteredPacks.length ? (
                  <div className="production-assets__cards">
                    {filteredPacks.map((pack) => (
                      <button
                        key={pack.id}
                        type="button"
                        className={`production-assets__card${pack.id === selectedPackId ? " is-active" : ""}`}
                        onClick={() => setSelectedPackId(pack.id)}
                      >
                        <div>
                          <strong>{pack.name}</strong>
                          <div className="muted">{pack.description ?? "No description yet."}</div>
                        </div>
                        <div className="production-assets__card-meta">
                          <span className={`meta-pill meta-pill--${pack.active_status ? "success" : "warning"}`}>
                            {pack.active_status ? "Active" : "Inactive"}
                          </span>
                          <span className="meta-pill">{humanize(pack.validation_status)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state empty-state--panel">No background packs match this search yet.</div>
                )}
              </>
            ) : null}

            {activeTab === "licenses" ? (
              <>
                {creatingLicense ? (
                  <ToolLicenseCreateForm
                    onCancel={() => setCreatingLicense(false)}
                    onCreate={(payload) => {
                      void createToolLicense(token, payload).then(() => {
                        setCreatingLicense(false);
                        setSaveNotice("License added.");
                        reloadWorkspace();
                      });
                    }}
                  />
                ) : null}
                {filteredLicenses.length ? (
                  <div className="production-assets__cards">
                    {filteredLicenses.map((license) => (
                      <button
                        key={license.id}
                        type="button"
                        className={`production-assets__card${license.id === selectedLicenseId ? " is-active" : ""}`}
                        onClick={() => setSelectedLicenseId(license.id)}
                      >
                        <div>
                          <strong>{license.tool_name}</strong>
                          <div className="muted">{license.notes ?? "No notes yet."}</div>
                        </div>
                        <div className="production-assets__card-meta">
                          <span className={`meta-pill meta-pill--${license.status === "active" ? "success" : "warning"}`}>
                            {humanize(license.status)}
                          </span>
                          <span className="meta-pill">{humanize(license.license_type)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state empty-state--panel">No licenses match this search yet.</div>
                )}
              </>
            ) : null}
          </div>

          <div className="production-assets__detail panel">
            {activeTab === "presets" ? (
              <PresetDetailPanel
                preset={selectedPreset}
                draft={presetDraft}
                setDraft={setPresetDraft}
                onSave={() => {
                  if (!presetDraft) {
                    return;
                  }
                  void updateProductionPreset(token, presetDraft.id, {
                    name: presetDraft.name,
                    description: presetDraft.description,
                    active_status: presetDraft.active_status,
                    validation_status: presetDraft.validation_status,
                    owner_user_id: presetDraft.owner_user_id,
                    job_types: presetDraft.job_types,
                    glasses_handling: presetDraft.glasses_handling,
                    known_issues: presetDraft.known_issues,
                    notes: presetDraft.notes
                  }).then(() => {
                    setSaveNotice("Preset saved.");
                    reloadWorkspace();
                  });
                }}
                onCreateVersion={(payload) => {
                  if (!selectedPreset) {
                    return;
                  }
                  void createPresetVersion(token, selectedPreset.id, payload).then(() => {
                    setCreatingVersionForPreset(false);
                    setSaveNotice("Preset version added.");
                    reloadWorkspace();
                  });
                }}
                creatingVersion={creatingVersionForPreset}
                setCreatingVersion={setCreatingVersionForPreset}
                onUpdateVersion={(versionId, payload) => {
                  void updatePresetVersion(token, versionId, payload).then(() => {
                    setSaveNotice("Preset version updated.");
                    reloadWorkspace();
                  });
                }}
              />
            ) : null}

            {activeTab === "backgrounds" ? (
              <BackgroundPackDetailPanel
                pack={selectedPack}
                draft={packDraft}
                setDraft={setPackDraft}
                onSave={() => {
                  if (!packDraft) {
                    return;
                  }
                  void updateBackgroundPack(token, packDraft.id, {
                    name: packDraft.name,
                    description: packDraft.description,
                    active_status: packDraft.active_status,
                    validation_status: packDraft.validation_status,
                    owner_user_id: packDraft.owner_user_id,
                    job_types: packDraft.job_types,
                    notes: packDraft.notes
                  }).then(() => {
                    setSaveNotice("Background pack saved.");
                    reloadWorkspace();
                  });
                }}
                onCreateVariant={(payload) => {
                  if (!selectedPack) {
                    return;
                  }
                  void createBackgroundVariant(token, selectedPack.id, payload).then(() => {
                    setCreatingVariantForPack(false);
                    setSaveNotice("Background variant added.");
                    reloadWorkspace();
                  });
                }}
                creatingVariant={creatingVariantForPack}
                setCreatingVariant={setCreatingVariantForPack}
                onUpdateVariant={(variantId, payload) => {
                  void updateBackgroundVariant(token, variantId, payload).then(() => {
                    setSaveNotice("Background variant updated.");
                    reloadWorkspace();
                  });
                }}
              />
            ) : null}

            {activeTab === "licenses" ? (
              <ToolLicenseDetailPanel
                license={selectedLicense}
                draft={licenseDraft}
                setDraft={setLicenseDraft}
                onSave={() => {
                  if (!licenseDraft) {
                    return;
                  }
                  void updateToolLicense(token, licenseDraft.id, {
                    tool_name: licenseDraft.tool_name,
                    license_type: licenseDraft.license_type,
                    seat_count: licenseDraft.seat_count,
                    status: licenseDraft.status,
                    owner_user_id: licenseDraft.owner_user_id,
                    renewal_date: licenseDraft.renewal_date,
                    notes: licenseDraft.notes,
                    restrictions: licenseDraft.restrictions
                  }).then(() => {
                    setSaveNotice("License saved.");
                    reloadWorkspace();
                  });
                }}
              />
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}

function PresetCreateForm({ onCancel, onCreate }: { onCancel: () => void; onCreate: (payload: Record<string, unknown>) => void }) {
  const [name, setName] = useState("");
  const [jobTypes, setJobTypes] = useState<ProductionAssetJobType[]>([]);
  const [notes, setNotes] = useState("");

  return (
    <div className="production-assets__form">
      <div className="section-title">New Preset</div>
      <label className="filter-field">
        <span>Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="production-assets__checkboxes">
        {JOB_TYPE_OPTIONS.map((option) => (
          <label key={option.value} className="checkbox-row">
            <input
              type="checkbox"
              checked={jobTypes.includes(option.value)}
              onChange={(event) =>
                setJobTypes((current) => (event.target.checked ? [...current, option.value] : current.filter((item) => item !== option.value)))
              }
            />
            {option.label}
          </label>
        ))}
      </div>
      <label className="filter-field">
        <span>Notes</span>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <div className="production-assets__form-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            onCreate({ name, job_types: jobTypes, notes: notes || null });
            setName("");
            setNotes("");
            setJobTypes([]);
          }}
          disabled={!name.trim()}
        >
          Create Preset
        </button>
      </div>
    </div>
  );
}

function BackgroundPackCreateForm({ onCancel, onCreate }: { onCancel: () => void; onCreate: (payload: Record<string, unknown>) => void }) {
  const [name, setName] = useState("");
  const [jobTypes, setJobTypes] = useState<ProductionAssetJobType[]>([]);
  const [notes, setNotes] = useState("");

  return (
    <div className="production-assets__form">
      <div className="section-title">New Background Pack</div>
      <label className="filter-field">
        <span>Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="production-assets__checkboxes">
        {JOB_TYPE_OPTIONS.map((option) => (
          <label key={option.value} className="checkbox-row">
            <input
              type="checkbox"
              checked={jobTypes.includes(option.value)}
              onChange={(event) =>
                setJobTypes((current) => (event.target.checked ? [...current, option.value] : current.filter((item) => item !== option.value)))
              }
            />
            {option.label}
          </label>
        ))}
      </div>
      <label className="filter-field">
        <span>Notes</span>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <div className="production-assets__form-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            onCreate({ name, job_types: jobTypes, notes: notes || null });
            setName("");
            setNotes("");
            setJobTypes([]);
          }}
          disabled={!name.trim()}
        >
          Create Pack
        </button>
      </div>
    </div>
  );
}

function ToolLicenseCreateForm({ onCancel, onCreate }: { onCancel: () => void; onCreate: (payload: Record<string, unknown>) => void }) {
  const [toolName, setToolName] = useState("");
  const [licenseType, setLicenseType] = useState<ProductionAssetLicenseType>("subscription");
  const [status, setStatus] = useState<ProductionAssetLicenseStatus>("active");
  const [seatCount, setSeatCount] = useState("");

  return (
    <div className="production-assets__form">
      <div className="section-title">New Tool License</div>
      <label className="filter-field">
        <span>Tool Name</span>
        <input value={toolName} onChange={(event) => setToolName(event.target.value)} />
      </label>
      <label className="filter-field">
        <span>License Type</span>
        <select value={licenseType} onChange={(event) => setLicenseType(event.target.value as ProductionAssetLicenseType)}>
          {LICENSE_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        <span>Status</span>
        <select value={status} onChange={(event) => setStatus(event.target.value as ProductionAssetLicenseStatus)}>
          {LICENSE_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        <span>Seat Count</span>
        <input value={seatCount} onChange={(event) => setSeatCount(event.target.value)} />
      </label>
      <div className="production-assets__form-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            const seat = seatCount.trim() ? Number(seatCount) : null;
            onCreate({
              tool_name: toolName,
              license_type: licenseType,
              status,
              seat_count: Number.isNaN(seat) ? null : seat
            });
            setToolName("");
            setSeatCount("");
          }}
          disabled={!toolName.trim()}
        >
          Add License
        </button>
      </div>
    </div>
  );
}

function PresetDetailPanel({
  preset,
  draft,
  setDraft,
  onSave,
  onCreateVersion,
  onUpdateVersion,
  creatingVersion,
  setCreatingVersion
}: {
  preset: ProductionAssetPreset | null;
  draft: ProductionAssetPreset | null;
  setDraft: (value: ProductionAssetPreset | null) => void;
  onSave: () => void;
  onCreateVersion: (payload: Record<string, unknown>) => void;
  onUpdateVersion: (versionId: string, payload: Record<string, unknown>) => void;
  creatingVersion: boolean;
  setCreatingVersion: (value: boolean) => void;
}) {
  if (!preset || !draft) {
    return <div className="empty-state empty-state--panel">Select a preset to review details.</div>;
  }

  return (
    <>
      <div className="production-assets__detail-header">
        <div>
          <div className="section-title">{preset.name}</div>
          <p className="section-subtitle">Track validation, versioning, and job applicability.</p>
        </div>
        <button type="button" className="primary-button" onClick={onSave}>
          Save Changes
        </button>
      </div>

      <div className="production-assets__detail-grid">
        <label className="filter-field">
          <span>Name</span>
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label className="filter-field">
          <span>Validation</span>
          <select
            value={draft.validation_status}
            onChange={(event) => setDraft({ ...draft, validation_status: event.target.value as ProductionAssetValidationStatus })}
          >
            {VALIDATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Active</span>
          <select
            value={draft.active_status ? "active" : "inactive"}
            onChange={(event) => setDraft({ ...draft, active_status: event.target.value === "active" })}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <label className="filter-field">
          <span>Owner User ID</span>
          <input
            value={draft.owner_user_id ?? ""}
            placeholder="Optional user id"
            onChange={(event) => setDraft({ ...draft, owner_user_id: event.target.value || null })}
          />
        </label>
      </div>

      <label className="filter-field">
        <span>Description</span>
        <textarea value={draft.description ?? ""} onChange={(event) => setDraft({ ...draft, description: event.target.value || null })} />
      </label>

      <div className="production-assets__checkboxes">
        {JOB_TYPE_OPTIONS.map((option) => (
          <label key={option.value} className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.job_types.includes(option.value)}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  job_types: event.target.checked
                    ? [...draft.job_types, option.value]
                    : draft.job_types.filter((item) => item !== option.value)
                })
              }
            />
            {option.label}
          </label>
        ))}
      </div>

      <label className="filter-field">
        <span>Glasses Handling</span>
        <textarea
          value={draft.glasses_handling ?? ""}
          onChange={(event) => setDraft({ ...draft, glasses_handling: event.target.value || null })}
        />
      </label>

      <label className="filter-field">
        <span>Known Issues</span>
        <textarea
          value={draft.known_issues ?? ""}
          onChange={(event) => setDraft({ ...draft, known_issues: event.target.value || null })}
        />
      </label>

      <label className="filter-field">
        <span>Notes</span>
        <textarea value={draft.notes ?? ""} onChange={(event) => setDraft({ ...draft, notes: event.target.value || null })} />
      </label>

      <div className="production-assets__subsection">
        <div className="production-assets__subsection-header">
          <strong>Preset Versions</strong>
          <button type="button" className="secondary-button" onClick={() => setCreatingVersion(!creatingVersion)}>
            {creatingVersion ? "Cancel" : "Add Version"}
          </button>
        </div>
        {creatingVersion ? (
          <PresetVersionCreateForm
            onCreate={(payload) => {
              onCreateVersion(payload);
            }}
          />
        ) : null}
        {preset.versions.length ? (
          <div className="production-assets__version-list">
            {preset.versions.map((version) => (
              <PresetVersionRow key={version.id} version={version} onUpdate={onUpdateVersion} />
            ))}
          </div>
        ) : (
          <div className="empty-state empty-state--panel">No preset versions yet.</div>
        )}
      </div>
    </>
  );
}

function PresetVersionCreateForm({ onCreate }: { onCreate: (payload: Record<string, unknown>) => void }) {
  const [label, setLabel] = useState("");
  const [validation, setValidation] = useState<ProductionAssetValidationStatus>("unvalidated");

  return (
    <div className="production-assets__inline-form">
      <label className="filter-field">
        <span>Version Label</span>
        <input value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <label className="filter-field">
        <span>Validation</span>
        <select value={validation} onChange={(event) => setValidation(event.target.value as ProductionAssetValidationStatus)}>
          {VALIDATION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="primary-button"
        onClick={() => {
          onCreate({ version_label: label, validation_status: validation });
          setLabel("");
        }}
        disabled={!label.trim()}
      >
        Add Version
      </button>
    </div>
  );
}

function PresetVersionRow({
  version,
  onUpdate
}: {
  version: ProductionAssetPresetVersion;
  onUpdate: (versionId: string, payload: Record<string, unknown>) => void;
}) {
  const [validation, setValidation] = useState<ProductionAssetValidationStatus>(version.validation_status);
  const [active, setActive] = useState(version.active_status);

  return (
    <div className="production-assets__version-row">
      <div>
        <strong>{version.version_label}</strong>
        <div className="muted">Updated {new Date(version.updated_at).toLocaleDateString()}</div>
      </div>
      <label className="filter-field">
        <span>Validation</span>
        <select value={validation} onChange={(event) => setValidation(event.target.value as ProductionAssetValidationStatus)}>
          {VALIDATION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        <span>Status</span>
        <select value={active ? "active" : "inactive"} onChange={(event) => setActive(event.target.value === "active")}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </label>
      <button type="button" className="secondary-button" onClick={() => onUpdate(version.id, { validation_status: validation, active_status: active })}>
        Update
      </button>
    </div>
  );
}

function BackgroundPackDetailPanel({
  pack,
  draft,
  setDraft,
  onSave,
  onCreateVariant,
  onUpdateVariant,
  creatingVariant,
  setCreatingVariant
}: {
  pack: ProductionBackgroundPack | null;
  draft: ProductionBackgroundPack | null;
  setDraft: (value: ProductionBackgroundPack | null) => void;
  onSave: () => void;
  onCreateVariant: (payload: Record<string, unknown>) => void;
  onUpdateVariant: (variantId: string, payload: Record<string, unknown>) => void;
  creatingVariant: boolean;
  setCreatingVariant: (value: boolean) => void;
}) {
  if (!pack || !draft) {
    return <div className="empty-state empty-state--panel">Select a background pack to review details.</div>;
  }

  return (
    <>
      <div className="production-assets__detail-header">
        <div>
          <div className="section-title">{pack.name}</div>
          <p className="section-subtitle">Track validation, usage scope, and variant coverage.</p>
        </div>
        <button type="button" className="primary-button" onClick={onSave}>
          Save Changes
        </button>
      </div>

      <div className="production-assets__detail-grid">
        <label className="filter-field">
          <span>Name</span>
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label className="filter-field">
          <span>Validation</span>
          <select
            value={draft.validation_status}
            onChange={(event) => setDraft({ ...draft, validation_status: event.target.value as ProductionAssetValidationStatus })}
          >
            {VALIDATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Active</span>
          <select value={draft.active_status ? "active" : "inactive"} onChange={(event) => setDraft({ ...draft, active_status: event.target.value === "active" })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <label className="filter-field">
          <span>Owner User ID</span>
          <input value={draft.owner_user_id ?? ""} onChange={(event) => setDraft({ ...draft, owner_user_id: event.target.value || null })} />
        </label>
      </div>

      <label className="filter-field">
        <span>Description</span>
        <textarea value={draft.description ?? ""} onChange={(event) => setDraft({ ...draft, description: event.target.value || null })} />
      </label>

      <div className="production-assets__checkboxes">
        {JOB_TYPE_OPTIONS.map((option) => (
          <label key={option.value} className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.job_types.includes(option.value)}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  job_types: event.target.checked
                    ? [...draft.job_types, option.value]
                    : draft.job_types.filter((item) => item !== option.value)
                })
              }
            />
            {option.label}
          </label>
        ))}
      </div>

      <label className="filter-field">
        <span>Notes</span>
        <textarea value={draft.notes ?? ""} onChange={(event) => setDraft({ ...draft, notes: event.target.value || null })} />
      </label>

      <div className="production-assets__subsection">
        <div className="production-assets__subsection-header">
          <strong>Variants</strong>
          <button type="button" className="secondary-button" onClick={() => setCreatingVariant(!creatingVariant)}>
            {creatingVariant ? "Cancel" : "Add Variant"}
          </button>
        </div>
        {creatingVariant ? (
          <BackgroundVariantCreateForm
            onCreate={(payload) => {
              onCreateVariant(payload);
            }}
          />
        ) : null}
        {pack.variants.length ? (
          <div className="production-assets__version-list">
            {pack.variants.map((variant) => (
              <BackgroundVariantRow key={variant.id} variant={variant} onUpdate={onUpdateVariant} />
            ))}
          </div>
        ) : (
          <div className="empty-state empty-state--panel">No background variants yet.</div>
        )}
      </div>
    </>
  );
}

function BackgroundVariantCreateForm({ onCreate }: { onCreate: (payload: Record<string, unknown>) => void }) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <div className="production-assets__inline-form">
      <label className="filter-field">
        <span>Variant Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="filter-field">
        <span>Notes</span>
        <input value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <button
        type="button"
        className="primary-button"
        onClick={() => {
          onCreate({ name, notes: notes || null });
          setName("");
          setNotes("");
        }}
        disabled={!name.trim()}
      >
        Add Variant
      </button>
    </div>
  );
}

function BackgroundVariantRow({
  variant,
  onUpdate
}: {
  variant: ProductionBackgroundVariant;
  onUpdate: (variantId: string, payload: Record<string, unknown>) => void;
}) {
  const [active, setActive] = useState(variant.active_status);
  const [notes, setNotes] = useState(variant.notes ?? "");

  return (
    <div className="production-assets__version-row">
      <div>
        <strong>{variant.name}</strong>
        <div className="muted">Updated {new Date(variant.updated_at).toLocaleDateString()}</div>
      </div>
      <label className="filter-field">
        <span>Status</span>
        <select value={active ? "active" : "inactive"} onChange={(event) => setActive(event.target.value === "active")}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </label>
      <label className="filter-field">
        <span>Notes</span>
        <input value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <button type="button" className="secondary-button" onClick={() => onUpdate(variant.id, { active_status: active, notes })}>
        Update
      </button>
    </div>
  );
}

function ToolLicenseDetailPanel({
  license,
  draft,
  setDraft,
  onSave
}: {
  license: ProductionToolLicense | null;
  draft: ProductionToolLicense | null;
  setDraft: (value: ProductionToolLicense | null) => void;
  onSave: () => void;
}) {
  if (!license || !draft) {
    return <div className="empty-state empty-state--panel">Select a license to review details.</div>;
  }

  return (
    <>
      <div className="production-assets__detail-header">
        <div>
          <div className="section-title">{license.tool_name}</div>
          <p className="section-subtitle">Track license status, seats, and renewal timing.</p>
        </div>
        <button type="button" className="primary-button" onClick={onSave}>
          Save Changes
        </button>
      </div>

      <div className="production-assets__detail-grid">
        <label className="filter-field">
          <span>Tool Name</span>
          <input value={draft.tool_name} onChange={(event) => setDraft({ ...draft, tool_name: event.target.value })} />
        </label>
        <label className="filter-field">
          <span>License Type</span>
          <select value={draft.license_type} onChange={(event) => setDraft({ ...draft, license_type: event.target.value as ProductionAssetLicenseType })}>
            {LICENSE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Status</span>
          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ProductionAssetLicenseStatus })}>
            {LICENSE_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Seat Count</span>
          <input
            value={draft.seat_count ?? ""}
            onChange={(event) => setDraft({ ...draft, seat_count: event.target.value ? Number(event.target.value) : null })}
          />
        </label>
        <label className="filter-field">
          <span>Owner User ID</span>
          <input value={draft.owner_user_id ?? ""} onChange={(event) => setDraft({ ...draft, owner_user_id: event.target.value || null })} />
        </label>
        <label className="filter-field">
          <span>Renewal Date</span>
          <input
            type="date"
            value={draft.renewal_date ?? ""}
            onChange={(event) => setDraft({ ...draft, renewal_date: event.target.value || null })}
          />
        </label>
      </div>

      <label className="filter-field">
        <span>Notes</span>
        <textarea value={draft.notes ?? ""} onChange={(event) => setDraft({ ...draft, notes: event.target.value || null })} />
      </label>

      <label className="filter-field">
        <span>Restrictions</span>
        <textarea
          value={draft.restrictions ?? ""}
          onChange={(event) => setDraft({ ...draft, restrictions: event.target.value || null })}
        />
      </label>
    </>
  );
}

function buildSummary(workspace: ProductionAssetWorkspace | null) {
  const presets = workspace?.presets ?? [];
  const packs = workspace?.background_packs ?? [];
  const licenses = workspace?.licenses ?? [];
  return {
    activePresets: presets.filter((preset) => preset.active_status).length,
    validatedPresets: presets.filter((preset) => preset.validation_status === "validated").length,
    activeBackgroundPacks: packs.filter((pack) => pack.active_status).length,
    validatedBackgroundPacks: packs.filter((pack) => pack.validation_status === "validated").length,
    activeLicenses: licenses.filter((license) => license.status === "active").length,
    expiringLicenses: licenses.filter((license) => license.status === "expiring").length
  };
}

function filterBySearch<T>(
  items: T[],
  search: string,
  selector: (item: T) => Array<string | null | undefined>
) {
  const normalized = search.trim().toLowerCase();
  if (!normalized) {
    return items;
  }
  return items.filter((item) =>
    selector(item)
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalized)
  );
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}
