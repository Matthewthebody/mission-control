import { useEffect, useMemo, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { OverlayPanel } from "../components/OverlayPanel";
import { OperationalDetailSection } from "../components/OperationalDetailSection";
import { OperationalPreviewCard, type OperationalPreviewChip, type OperationalPreviewTone } from "../components/OperationalPreviewCard";
import { SalesCommunicationPanel } from "../components/SalesCommunicationPanel";
import { canAccessSalesPipeline } from "../permissions";
import { getOrganizationDetail, listOrganizations } from "../services/organizationApi";
import {
  createSalesOpportunityRecord,
  getSalesOpportunityDetail,
  getSalesPipelineBoard,
  listSalesOpportunities,
  listSalesPipelineOwners,
  sendSalesEmailCommunication,
  updateSalesOpportunityRecord
} from "../services/salesPipelineApi";
import type {
  SalesOpportunityDetail,
  SalesOpportunityStage,
  SalesOpportunitySummary,
  SalesOpportunityType,
  SalesPipelineAlertRecord,
  SalesPipelineBoardView,
  SalesPipelineLane,
  SalesPipelineOwnerOption,
  SalesPipelineType
} from "../salesPipelineTypes";
import type { OrganizationDetail, OrganizationSummary, SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type ViewMode = "board" | "list";
type FormMode = "create" | "edit" | null;

type OpportunityFormState = {
  organizationId: string;
  primaryContactId: string;
  ownerId: string;
  opportunityType: SalesOpportunityType;
  pipelineType: SalesPipelineType;
  stage: SalesOpportunityStage;
  estimatedValue: string;
  nextActionDate: string;
  lastTouchDate: string;
  lastVerifiedContactDate: string;
  followUpDate: string;
  notes: string;
};

const STAGE_OPTIONS: Array<{ value: SalesOpportunityStage | "all"; label: string }> = [
  { value: "all", label: "All stages" },
  { value: "lead", label: "Lead" },
  { value: "contacted", label: "Contacted" },
  { value: "meeting_scheduled", label: "Meeting Scheduled" },
  { value: "proposal_sent", label: "Proposal Sent" },
  { value: "follow_up", label: "Follow-Up" },
  { value: "negotiation", label: "Negotiation" },
  { value: "contract_sent", label: "Contract Sent" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "dormant", label: "Dormant" }
];

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "dormant", label: "Dormant" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" }
] as const;

const TYPE_OPTIONS: Array<{ value: SalesOpportunityType; label: string }> = [
  { value: "new", label: "New" },
  { value: "renewal", label: "Renewal" },
  { value: "expansion", label: "Expansion" }
];

export function SalesPipeline({ token, currentUser }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [pipelineFilter, setPipelineFilter] = useState<SalesPipelineType | "all">("all");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<SalesOpportunityStage | "all">("all");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]["value"]>("all");
  const [resurfacingOnly, setResurfacingOnly] = useState(false);
  const [owners, setOwners] = useState<SalesPipelineOwnerOption[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [board, setBoard] = useState<SalesPipelineBoardView | null>(null);
  const [list, setList] = useState<Awaited<ReturnType<typeof listSalesOpportunities>> | null>(null);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SalesOpportunityDetail | null>(null);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [form, setForm] = useState<OpportunityFormState>(() => buildEmptyForm("schools"));
  const [selectedOrganizationDetail, setSelectedOrganizationDetail] = useState<OrganizationDetail | null>(null);
  const [loadingOwners, setLoadingOwners] = useState(true);
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingOrganizationDetail, setLoadingOrganizationDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingCommunication, setSendingCommunication] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canViewPipeline = canAccessSalesPipeline(currentUser);
  const automationSummary = list?.automation_summary ?? board?.automation_summary ?? null;
  const automationAlerts = list?.automation_alerts ?? board?.automation_alerts ?? [];

  const visibleOpportunityIds = useMemo(() => {
    if (viewMode === "board") {
      return (board?.pipelines ?? []).flatMap((pipeline) =>
        pipeline.stage_columns.flatMap((column) => column.opportunities.map((opportunity) => opportunity.id))
      );
    }
    return (list?.opportunities ?? []).map((opportunity) => opportunity.id);
  }, [board?.pipelines, list?.opportunities, viewMode]);

  const allowedPipelineTypes = useMemo(() => {
    const allowed = new Set<SalesPipelineType>();
    for (const value of board?.allowed_pipeline_types ?? []) {
      allowed.add(value);
    }
    for (const value of list?.allowed_pipeline_types ?? []) {
      allowed.add(value);
    }
    if (!allowed.size) {
      if (["super_admin", "leadership", "director_admin"].includes(currentUser.authorityTier)) {
        allowed.add("schools");
        allowed.add("sports");
      } else if (currentUser.jobFunctionProfiles.includes("schools_client_success")) {
        allowed.add("schools");
      } else if (currentUser.jobFunctionProfiles.includes("sports_client_success")) {
        allowed.add("sports");
      }
    }
    return [...allowed];
  }, [board?.allowed_pipeline_types, currentUser.authorityTier, currentUser.jobFunctionProfiles, list?.allowed_pipeline_types]);

  useEffect(() => {
    if (!canViewPipeline) {
      setLoadingOwners(false);
      return;
    }
    let cancelled = false;
    setLoadingOwners(true);
    void Promise.all([listSalesPipelineOwners(token), listOrganizations(token, { activeStatus: "active", accountType: "all" })])
      .then(([ownerRows, organizationResponse]) => {
        if (cancelled) {
          return;
        }
        setOwners(ownerRows);
        setOrganizations(organizationResponse.organizations);
        setError("");
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "We couldn't load Sales Pipeline setup data.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingOwners(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canViewPipeline, token]);

  useEffect(() => {
    if (!canViewPipeline) {
      setLoadingBoard(false);
      return;
    }
    let cancelled = false;
    setLoadingBoard(true);
    void getSalesPipelineBoard(token, { pipelineType: pipelineFilter, ownerId: ownerFilter || null })
      .then((payload) => {
        if (!cancelled) {
          setBoard(payload);
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "We couldn't load the Sales Pipeline board.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingBoard(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canViewPipeline, ownerFilter, pipelineFilter, token]);

  useEffect(() => {
    if (!canViewPipeline) {
      setLoadingList(false);
      return;
    }
    let cancelled = false;
    setLoadingList(true);
    void listSalesOpportunities(token, {
      search,
      pipelineType: pipelineFilter,
      stage: stageFilter,
      status: statusFilter,
      ownerId: ownerFilter || null,
      resurfacingOnly
    })
      .then((payload) => {
        if (!cancelled) {
          setList(payload);
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "We couldn't load sales opportunities.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingList(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canViewPipeline, ownerFilter, pipelineFilter, resurfacingOnly, search, stageFilter, statusFilter, token]);

  useEffect(() => {
    if (formMode) {
      return;
    }
    if (selectedOpportunityId && visibleOpportunityIds.includes(selectedOpportunityId)) {
      return;
    }
    setSelectedOpportunityId(visibleOpportunityIds[0] ?? null);
  }, [formMode, selectedOpportunityId, visibleOpportunityIds]);

  useEffect(() => {
    if (!selectedOpportunityId || formMode || !canViewPipeline) {
      if (!selectedOpportunityId && !formMode) {
        setDetail(null);
      }
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    void getSalesOpportunityDetail(token, selectedOpportunityId)
      .then((payload) => {
        if (!cancelled) {
          setDetail(payload);
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "We couldn't load this opportunity.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canViewPipeline, formMode, selectedOpportunityId, token]);

  const organizationContextId = formMode ? form.organizationId : detail?.opportunity.organization_id ?? "";

  useEffect(() => {
    if (!organizationContextId || !canViewPipeline) {
      setSelectedOrganizationDetail(null);
      setLoadingOrganizationDetail(false);
      return;
    }
    let cancelled = false;
    setLoadingOrganizationDetail(true);
    void getOrganizationDetail(token, organizationContextId)
      .then((payload) => {
        if (!cancelled) {
          setSelectedOrganizationDetail(payload);
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "We couldn't load Organization contacts for this opportunity.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingOrganizationDetail(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canViewPipeline, organizationContextId, token]);

  async function refreshPipelineViews() {
    const [boardPayload, listPayload] = await Promise.all([
      getSalesPipelineBoard(token, { pipelineType: pipelineFilter, ownerId: ownerFilter || null }),
      listSalesOpportunities(token, {
        search,
        pipelineType: pipelineFilter,
        stage: stageFilter,
        status: statusFilter,
        ownerId: ownerFilter || null,
        resurfacingOnly
      })
    ]);
    setBoard(boardPayload);
    setList(listPayload);
  }

  async function refreshSelectedDetail(opportunityId: string, organizationId: string) {
    const [detailPayload, organizationPayload] = await Promise.all([
      getSalesOpportunityDetail(token, opportunityId),
      getOrganizationDetail(token, organizationId)
    ]);
    setDetail(detailPayload);
    setSelectedOrganizationDetail(organizationPayload);
  }

  async function handleSendCommunication(input: {
    organization_id: string;
    opportunity_id?: string | null;
    contact_id: string;
    template_id: string;
    subject: string;
    body: string;
  }) {
    setSendingCommunication(true);
    setError("");
    setNotice("");
    try {
      await sendSalesEmailCommunication(token, input);
      if (selectedOpportunityId && detail?.opportunity.organization_id) {
        await refreshSelectedDetail(selectedOpportunityId, detail.opportunity.organization_id);
      }
      await refreshPipelineViews();
      setNotice("Email queued for delivery.");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "We couldn't queue this email.");
      throw sendError;
    } finally {
      setSendingCommunication(false);
    }
  }

  function handleStartCreate() {
    setNotice("");
    setError("");
    setSelectedOpportunityId(null);
    setDetail(null);
    setFormMode("create");
    setForm(buildEmptyForm(getInitialPipelineForForm(pipelineFilter, allowedPipelineTypes)));
  }

  function handleStartEdit() {
    if (!detail) {
      return;
    }
    setNotice("");
    setError("");
    setFormMode("edit");
    setForm(mapOpportunityToForm(detail.opportunity));
  }

  function handleCancelEdit() {
    setFormMode(null);
    setNotice("");
  }

  async function handleSaveOpportunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");

    try {
      if (!form.organizationId) {
        throw new Error("Choose an Organization before saving the opportunity.");
      }

      const payload = {
        organization_id: form.organizationId,
        primary_contact_id: form.primaryContactId || null,
        owner_id: form.ownerId || null,
        opportunity_type: form.opportunityType,
        pipeline_type: form.pipelineType,
        stage: form.stage,
        estimated_value: parseNullableCurrency(form.estimatedValue),
        next_action_date: form.nextActionDate,
        last_touch_date: form.lastTouchDate || null,
        last_verified_contact_date: form.lastVerifiedContactDate || null,
        notes: form.notes.trim() || null,
        follow_up_date: form.followUpDate || null
      };

      const result =
        formMode === "edit" && selectedOpportunityId
          ? await updateSalesOpportunityRecord(token, selectedOpportunityId, payload)
          : await createSalesOpportunityRecord(token, payload);

      setDetail(result);
      setSelectedOpportunityId(result.opportunity.id);
      setFormMode(null);
      await refreshPipelineViews();
      setNotice(formMode === "edit" ? "Opportunity updated." : "Opportunity created.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn't save this opportunity.");
    } finally {
      setSaving(false);
    }
  }

  if (!canViewPipeline) {
    return (
      <section className="panel loading-panel">
        <div className="section-title">Sales Pipeline access is restricted</div>
        <p className="section-subtitle">Mission Control keeps opportunity tracking limited to leadership and client success roles.</p>
      </section>
    );
  }

  return (
    <div className="workspace-shell">
      <section className="page-intro page-intro--workspace panel">
        <div className="page-intro__body">
          <div className="eyebrow">Sales Pipeline</div>
          <h2>Schools and Sports opportunity management</h2>
          <p>Track long-cycle relationship work with clean stage discipline, visible dormant follow-up dates, and operational warnings before deals drift.</p>
        </div>
        <div className="page-intro-actions page-intro-actions--compact">
          <div className="metric-pill metric-pill--identity">Owner model Brenda-first</div>
          <div className="meta-pill">{currentUser.fullName}</div>
        </div>
      </section>

      <section className="panel workspace-toolbar">
        <div className="workspace-toolbar__group">
          <div className="report-tab-row">
            <button className={viewMode === "board" ? "is-active" : ""} onClick={() => setViewMode("board")}>Board</button>
            <button className={viewMode === "list" ? "is-active" : ""} onClick={() => setViewMode("list")}>List</button>
          </div>
          <label className="filter-field">
            <span>Pipeline</span>
            <select value={pipelineFilter} onChange={(event) => setPipelineFilter(event.target.value as SalesPipelineType | "all")}>
              <option value="all">All pipelines</option>
              {allowedPipelineTypes.includes("schools") ? <option value="schools">Schools Pipeline</option> : null}
              {allowedPipelineTypes.includes("sports") ? <option value="sports">Sports Pipeline</option> : null}
            </select>
          </label>
          <label className="filter-field">
            <span>Owner</span>
            <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
              <option value="">All owners</option>
              {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.full_name}</option>)}
            </select>
          </label>
        </div>
        <div className="workspace-toolbar__actions">
          <button className="secondary-button" onClick={() => void refreshPipelineViews()} disabled={loadingBoard || loadingList}>Refresh Pipeline</button>
          <button className="primary-button" onClick={handleStartCreate}>Create Opportunity</button>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}

      <section className="sales-summary-grid workspace-summary-strip">
        {buildSummaryCards(board, list).map((card) => (
          <article key={card.label} className="stat-card panel">
            <div className="eyebrow">{card.label}</div>
            <strong>{card.value}</strong>
            <span className="muted">{card.summary}</span>
          </article>
        ))}
      </section>

      <section className="panel dashboard-stack">
        <div className="dashboard-panel__header">
          <div>
            <div className="section-title">CRM Automation</div>
            <p className="section-subtitle">Reminder pressure, renewal timing, and follow-up hygiene for the active schools and sports book.</p>
          </div>
        </div>
        <section className="sales-summary-grid workspace-summary-strip">
          {buildAutomationCards(automationSummary).map((card) => (
            <article key={card.label} className="stat-card panel">
              <div className="eyebrow">{card.label}</div>
              <strong>{card.value}</strong>
              <span className="muted">{card.summary}</span>
            </article>
          ))}
        </section>
        <OperationalDetailSection title="Automation Alert Queue" summary="Open CRM alerts that should be visible before opportunities drift." defaultOpen>
          {automationAlerts.length ? (
            <div className="detail-two-column">
              {automationAlerts.map((alert) => (
                <article key={alert.id} className="request-card">
                  <strong>{alert.title}</strong>
                  <div className="muted">{alert.message}</div>
                  <div className="muted">
                    {labelForAlertSeverity(alert.severity)} | {labelForAlertType(alert.alert_type)}
                    {alert.due_at ? ` | Due ${formatShortDate(alert.due_at)}` : ""}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">No open CRM automation alerts are active right now.</div>
          )}
        </OperationalDetailSection>
      </section>

      <div className="sales-layout">
        <section className="panel sales-main">
          {viewMode === "board" ? (
            loadingBoard && !board ? (
              <section className="loading-panel">
                <div className="section-title">Loading pipeline board</div>
                <p className="section-subtitle">Pulling schools and sports opportunities, dormant follow-up pressure, and next-action drift.</p>
              </section>
            ) : (
              <BoardView
                board={board}
                selectedOpportunityId={selectedOpportunityId}
                onSelectOpportunity={(opportunityId) => {
                  setFormMode(null);
                  setSelectedOpportunityId(opportunityId);
                }}
              />
            )
          ) : loadingList && !list ? (
            <section className="loading-panel">
              <div className="section-title">Loading opportunity list</div>
              <p className="section-subtitle">Filtering opportunity activity, follow-up pressure, and dormant reactivation work.</p>
            </section>
          ) : (
            <div className="sales-list-shell">
              <section className="field-grid sales-list-filters">
                <label className="filter-field filter-field--wide">
                  <span>Search</span>
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Organization, Contact, owner, or notes" />
                </label>
                <label className="filter-field">
                  <span>Stage</span>
                  <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value as SalesOpportunityStage | "all")}>
                    {STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="filter-field">
                  <span>Status</span>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as (typeof STATUS_OPTIONS)[number]["value"])}>
                    {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="filter-field filter-field--checkbox">
                  <span>Resurfacing only</span>
                  <input type="checkbox" checked={resurfacingOnly} onChange={(event) => setResurfacingOnly(event.target.checked)} />
                </label>
              </section>
              <ListView
                list={list}
                selectedOpportunityId={selectedOpportunityId}
                onSelectOpportunity={(opportunityId) => {
                  setFormMode(null);
                  setSelectedOpportunityId(opportunityId);
                }}
              />
            </div>
          )}
        </section>

        <aside className="panel sales-detail-panel">
          {formMode === "edit" ? (
            <OpportunityEditor
              mode={formMode}
              form={form}
              organizations={organizations}
              owners={owners}
              organizationDetail={selectedOrganizationDetail}
              loadingOrganizationDetail={loadingOrganizationDetail}
              saving={saving}
              onChange={setForm}
              onCancel={handleCancelEdit}
              onSubmit={handleSaveOpportunity}
            />
          ) : detail ? (
            <OpportunityDetailPanel
              detail={detail}
              organizationDetail={selectedOrganizationDetail}
              loadingDetail={loadingDetail}
              sendingCommunication={sendingCommunication}
              currentUserName={currentUser.fullName}
              onSendCommunication={handleSendCommunication}
              onEdit={handleStartEdit}
            />
          ) : (
            <div className="empty-state empty-state--panel">Select an opportunity or create a new one to review stage rules, follow-up rhythm, and account context.</div>
          )}
        </aside>
      </div>

      <OverlayPanel
        open={formMode === "create"}
        ariaLabel="Create Opportunity"
        onClose={handleCancelEdit}
        contentClassName="workflow-overlay__content--narrow"
      >
        <div className="panel sales-detail-panel workflow-dialog-panel">
          <OpportunityEditor
            mode="create"
            form={form}
            organizations={organizations}
            owners={owners}
            organizationDetail={selectedOrganizationDetail}
            loadingOrganizationDetail={loadingOrganizationDetail}
            saving={saving}
            onChange={setForm}
            onCancel={handleCancelEdit}
            onSubmit={handleSaveOpportunity}
          />
        </div>
      </OverlayPanel>

      {loadingOwners ? (
        <section className="panel loading-panel">
          <div className="section-title">Loading pipeline setup</div>
          <p className="section-subtitle">Pulling owner options and Organization context for new opportunity creation.</p>
        </section>
      ) : null}
    </div>
  );
}

function BoardView({
  board,
  selectedOpportunityId,
  onSelectOpportunity
}: {
  board: SalesPipelineBoardView | null;
  selectedOpportunityId: string | null;
  onSelectOpportunity: (opportunityId: string) => void;
}) {
  if (!board || !board.pipelines.length) {
    return <div className="empty-state empty-state--panel">No opportunities are in the selected pipeline right now.</div>;
  }

  return (
    <div className="sales-board">
      {board.pipelines.map((pipeline) => (
        <article key={pipeline.pipeline_type} className="sales-pipeline-lane">
          <header className="sales-pipeline-lane__header">
            <div>
              <div className="eyebrow">{pipeline.label}</div>
              <h3>{pipeline.label}</h3>
            </div>
            <div className="sales-pipeline-lane__summary">
              {buildLaneSummaryChips(pipeline).map((chip) => (
                <span key={`${pipeline.pipeline_type}-${chip.label}`} className={`ops-preview-chip ops-preview-chip--${chip.tone ?? "neutral"}`}>
                  {chip.label}
                </span>
              ))}
            </div>
          </header>

          {pipeline.resurfacing_soon.length ? (
            <div className="sales-resurface-strip">
              <div className="eyebrow">Dormant Follow-Up Coming Due</div>
              <div className="sales-card-grid sales-card-grid--tight">
                {pipeline.resurfacing_soon.map((opportunity) => (
                  <OpportunityCard
                    key={opportunity.id}
                    opportunity={opportunity}
                    eyebrow="Resurfacing Soon"
                    selected={selectedOpportunityId === opportunity.id}
                    onClick={() => onSelectOpportunity(opportunity.id)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="sales-stage-grid">
            {pipeline.stage_columns.map((column) => (
              <section key={`${pipeline.pipeline_type}-${column.stage}`} className="sales-stage-column">
                <header className="sales-stage-column__header">
                  <strong>{column.label}</strong>
                  <span className="meta-pill">{column.opportunities.length}</span>
                </header>
                <div className="sales-card-grid">
                  {column.opportunities.length ? (
                    column.opportunities.map((opportunity) => (
                      <OpportunityCard
                        key={opportunity.id}
                        opportunity={opportunity}
                        eyebrow={labelForOpportunityType(opportunity.opportunity_type)}
                        selected={selectedOpportunityId === opportunity.id}
                        onClick={() => onSelectOpportunity(opportunity.id)}
                      />
                    ))
                  ) : (
                    <div className="empty-state">No opportunities in {column.label}.</div>
                  )}
                </div>
              </section>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function ListView({
  list,
  selectedOpportunityId,
  onSelectOpportunity
}: {
  list: Awaited<ReturnType<typeof listSalesOpportunities>> | null;
  selectedOpportunityId: string | null;
  onSelectOpportunity: (opportunityId: string) => void;
}) {
  if (!list || !list.opportunities.length) {
    return <div className="empty-state empty-state--panel">No opportunities match the current filters.</div>;
  }

  return (
    <div className="sales-card-grid">
      {list.opportunities.map((opportunity) => (
        <OpportunityCard
          key={opportunity.id}
          opportunity={opportunity}
          eyebrow={`${labelForPipeline(opportunity.pipeline_type)} | ${labelForOpportunityType(opportunity.opportunity_type)}`}
          selected={selectedOpportunityId === opportunity.id}
          onClick={() => onSelectOpportunity(opportunity.id)}
        />
      ))}
    </div>
  );
}

function OpportunityCard({
  opportunity,
  eyebrow,
  selected,
  onClick
}: {
  opportunity: SalesOpportunitySummary;
  eyebrow: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <OperationalPreviewCard
      eyebrow={eyebrow}
      title={opportunity.organization_display_name}
      summary={opportunity.primary_contact_name ? `Contact: ${opportunity.primary_contact_name}` : "No primary Contact linked yet."}
      owner={opportunity.owner_name}
      statusLabel={`${labelForStage(opportunity.stage)} | ${labelForStatus(opportunity.status)}`}
      statusTone={toneForAttention(opportunity.attention_state)}
      meta={buildOpportunityMeta(opportunity)}
      flags={buildOpportunityFlags(opportunity)}
      nextAction={formatNextAction(opportunity)}
      selected={selected}
      onClick={onClick}
    />
  );
}

function OpportunityDetailPanel({
  detail,
  organizationDetail,
  loadingDetail,
  sendingCommunication,
  currentUserName,
  onSendCommunication,
  onEdit
}: {
  detail: SalesOpportunityDetail;
  organizationDetail: OrganizationDetail | null;
  loadingDetail: boolean;
  sendingCommunication: boolean;
  currentUserName: string;
  onSendCommunication: (input: {
    organization_id: string;
    opportunity_id?: string | null;
    contact_id: string;
    template_id: string;
    subject: string;
    body: string;
  }) => Promise<void>;
  onEdit: () => void;
}) {
  const opportunity = detail.opportunity;

  return (
    <div className="sales-detail-shell">
      <section className="sales-detail-header">
        <div>
          <div className="eyebrow">{labelForPipeline(opportunity.pipeline_type)}</div>
          <h3>{opportunity.organization_display_name}</h3>
          <p>{labelForStage(opportunity.stage)} | {labelForStatus(opportunity.status)} | {labelForOpportunityType(opportunity.opportunity_type)}</p>
        </div>
        <div className="page-intro-actions page-intro-actions--compact">
          <button className="secondary-button" onClick={onEdit}>Edit Opportunity</button>
        </div>
      </section>

      {loadingDetail ? <div className="muted">Refreshing opportunity detail...</div> : null}

      <OperationalDetailSection title="Opportunity Summary" summary="Linked account, primary contact, pipeline ownership, and deal posture." defaultOpen>
        <div className="detail-grid">
          <article className="request-card"><strong>Organization</strong><div className="muted">{opportunity.organization_display_name}</div></article>
          <article className="request-card"><strong>Primary Contact</strong><div className="muted">{opportunity.primary_contact_name || "No Contact linked yet"}</div></article>
          <article className="request-card"><strong>Owner</strong><div className="muted">{opportunity.owner_name}</div></article>
          <article className="request-card"><strong>Estimated Value</strong><div className="muted">{formatCurrency(opportunity.estimated_value)}</div></article>
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection title="Follow-Up Rhythm" summary="Next action, last touch, dormant return date, and contact verification cadence." defaultOpen>
        <div className="detail-grid">
          <article className="request-card"><strong>Next Action Date</strong><div className="muted">{formatShortDate(opportunity.next_action_date)}</div></article>
          <article className="request-card"><strong>Last Touch Date</strong><div className="muted">{formatShortDate(opportunity.last_touch_date)}</div></article>
          <article className="request-card"><strong>Last Verified Contact Date</strong><div className="muted">{opportunity.last_verified_contact_date ? formatShortDate(opportunity.last_verified_contact_date) : "Not verified yet"}</div></article>
          <article className="request-card"><strong>Dormant Follow-Up Date</strong><div className="muted">{opportunity.follow_up_date ? formatShortDate(opportunity.follow_up_date) : "Not dormant"}</div></article>
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection title="Stage Rule Checks" summary="Business gates for proposal, contract, and won stages." defaultOpen>
        <div className="sales-rule-stack">
          <article className="request-card"><strong>Proposal Sent</strong><div className="muted">{detail.stage_rules.proposal_sent_blockers[0] || "Estimated value requirement is satisfied."}</div></article>
          <article className="request-card"><strong>Contract Sent</strong><div className="muted">{detail.stage_rules.contract_sent_blockers[0] || "Primary Contact info is ready for contract delivery."}</div></article>
          <article className="request-card"><strong>Won</strong><div className="muted">{detail.stage_rules.won_blockers[0] || `Agreement check clear. ${detail.stage_rules.signed_agreement_count} signed agreement record${detail.stage_rules.signed_agreement_count === 1 ? "" : "s"} found.`}</div></article>
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection title="Agreement Signal" summary="Account-level contract posture so pipeline and scheduling warnings stay consistent.">
        <div className="detail-grid">
          <article className="request-card"><strong>Active Agreement On File</strong><div className="muted">{organizationDetail?.agreement_summary.has_active_agreement ? "Yes" : "No active Agreement yet"}</div></article>
          <article className="request-card"><strong>Pending Signature</strong><div className="muted">{organizationDetail?.agreement_summary.has_pending_signature ? "Unsigned Agreement is in flight" : "No pending signature record"}</div></article>
          <article className="request-card"><strong>Expiring Soon</strong><div className="muted">{organizationDetail?.agreement_summary.has_expiring_soon ? "Expiring Agreement needs follow-up" : "No expiring Agreement warning"}</div></article>
          <article className="request-card"><strong>Expired</strong><div className="muted">{organizationDetail?.agreement_summary.has_expired ? "Expired Agreement warning is active" : "No expired Agreement warning"}</div></article>
          <article className="request-card"><strong>Upcoming Shoot Risk</strong><div className="muted">{organizationDetail?.agreement_summary.upcoming_shoot_risk_count ? `${organizationDetail.agreement_summary.upcoming_shoot_risk_count} upcoming Shoot${organizationDetail.agreement_summary.upcoming_shoot_risk_count === 1 ? "" : "s"} carry agreement risk.` : "No upcoming Shoot agreement warning."}</div></article>
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection title="Automation Alerts" summary="Opportunity-level reminders and escalations created by CRM automation." defaultOpen>
        {detail.alerts.length ? (
          <div className="detail-two-column">
            {detail.alerts.map((alert) => (
              <article key={alert.id} className="request-card">
                <strong>{alert.title}</strong>
                <div className="muted">{alert.message}</div>
                <div className="muted">
                  {labelForAlertSeverity(alert.severity)} | {labelForAlertType(alert.alert_type)}
                  {alert.due_at ? ` | Due ${formatShortDate(alert.due_at)}` : ""}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">No opportunity-specific CRM automation alerts are open right now.</div>
        )}
      </OperationalDetailSection>

      <SalesCommunicationPanel
        title="Communication Timeline"
        summary="Send templated outreach from this opportunity and keep delivery history attached to the linked account and Contact."
        templates={detail.email_templates ?? []}
        communications={detail.communications ?? []}
        contacts={organizationDetail?.contacts ?? []}
        organizationId={opportunity.organization_id}
        organizationName={opportunity.organization_display_name}
        senderName={currentUserName}
        opportunity={{
          id: opportunity.id,
          stage: opportunity.stage,
          pipeline_type: opportunity.pipeline_type,
          opportunity_type: opportunity.opportunity_type,
          estimated_value: opportunity.estimated_value,
          next_action_date: opportunity.next_action_date
        }}
        defaultContactId={opportunity.primary_contact_id}
        canSend
        sending={sendingCommunication}
        onSend={onSendCommunication}
      />

      <OperationalDetailSection title="Notes" summary="Long-cycle context, relationship nuance, and next-step framing.">
        <article className="request-card">
          <strong>Notes</strong>
          <div className="muted">{opportunity.notes || "No notes captured yet."}</div>
        </article>
      </OperationalDetailSection>
    </div>
  );
}

function OpportunityEditor({
  mode,
  form,
  organizations,
  owners,
  organizationDetail,
  loadingOrganizationDetail,
  saving,
  onChange,
  onCancel,
  onSubmit
}: {
  mode: Exclude<FormMode, null>;
  form: OpportunityFormState;
  organizations: OrganizationSummary[];
  owners: SalesPipelineOwnerOption[];
  organizationDetail: OrganizationDetail | null;
  loadingOrganizationDetail: boolean;
  saving: boolean;
  onChange: Dispatch<SetStateAction<OpportunityFormState>>;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <form className="sales-editor-form" onSubmit={onSubmit}>
      <section className="sales-detail-header">
        <div>
          <div className="eyebrow">{mode === "create" ? "Create Opportunity" : "Edit Opportunity"}</div>
          <h3>{mode === "create" ? "New Sales Opportunity" : "Update Sales Opportunity"}</h3>
          <p>Keep pipeline movement structured so follow-up pressure and stage rules stay trustworthy.</p>
        </div>
        <div className="page-intro-actions page-intro-actions--compact">
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
          <button type="submit" disabled={saving}>{saving ? "Saving..." : mode === "create" ? "Create Opportunity" : "Save Changes"}</button>
        </div>
      </section>

      <div className="field-grid">
        <label className="filter-field filter-field--wide"><span>Organization</span><select value={form.organizationId} onChange={(event) => onChange((current) => ({ ...current, organizationId: event.target.value, primaryContactId: "" }))}><option value="">Select Organization</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.display_name}</option>)}</select></label>
        <label className="filter-field"><span>Primary Contact</span><select value={form.primaryContactId} onChange={(event) => onChange((current) => ({ ...current, primaryContactId: event.target.value }))} disabled={!form.organizationId || loadingOrganizationDetail}><option value="">{loadingOrganizationDetail ? "Loading Contacts..." : "Select Contact"}</option>{(organizationDetail?.contacts ?? []).map((contact) => <option key={contact.id} value={contact.id}>{contact.full_name}</option>)}</select></label>
        <label className="filter-field"><span>Owner</span><select value={form.ownerId} onChange={(event) => onChange((current) => ({ ...current, ownerId: event.target.value }))}><option value="">Auto (Brenda if available)</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.full_name}</option>)}</select></label>
        <label className="filter-field"><span>Pipeline</span><select value={form.pipelineType} onChange={(event) => onChange((current) => ({ ...current, pipelineType: event.target.value as SalesPipelineType }))}><option value="schools">Schools Pipeline</option><option value="sports">Sports Pipeline</option></select></label>
        <label className="filter-field"><span>Opportunity Type</span><select value={form.opportunityType} onChange={(event) => onChange((current) => ({ ...current, opportunityType: event.target.value as SalesOpportunityType }))}>{TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="filter-field"><span>Stage</span><select value={form.stage} onChange={(event) => onChange((current) => ({ ...current, stage: event.target.value as SalesOpportunityStage }))}>{STAGE_OPTIONS.filter((option) => option.value !== "all").map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="filter-field"><span>Estimated Value</span><input value={form.estimatedValue} onChange={(event) => onChange((current) => ({ ...current, estimatedValue: event.target.value }))} placeholder="25000" /></label>
        <label className="filter-field"><span>Next Action Date</span><input type="date" value={form.nextActionDate} onChange={(event) => onChange((current) => ({ ...current, nextActionDate: event.target.value }))} /></label>
        <label className="filter-field"><span>Last Touch Date</span><input type="date" value={form.lastTouchDate} onChange={(event) => onChange((current) => ({ ...current, lastTouchDate: event.target.value }))} /></label>
        <label className="filter-field"><span>Last Verified Contact Date</span><input type="date" value={form.lastVerifiedContactDate} onChange={(event) => onChange((current) => ({ ...current, lastVerifiedContactDate: event.target.value }))} /></label>
        <label className="filter-field"><span>Follow-Up Date</span><input type="date" value={form.followUpDate} onChange={(event) => onChange((current) => ({ ...current, followUpDate: event.target.value }))} /></label>
        <label className="filter-field filter-field--wide"><span>Notes</span><textarea rows={6} value={form.notes} onChange={(event) => onChange((current) => ({ ...current, notes: event.target.value }))} placeholder="Relationship history, next step context, proposal nuance, or contract blockers" /></label>
      </div>

      <OperationalDetailSection title="Stage Gate Reminders" summary="Keep the pipeline honest while we build toward contract automation." defaultOpen>
        <div className="sales-rule-stack">
          <article className="request-card"><strong>Proposal Sent</strong><div className="muted">Requires Estimated Value.</div></article>
          <article className="request-card"><strong>Contract Sent</strong><div className="muted">Requires a Primary Contact with email or phone.</div></article>
          <article className="request-card"><strong>Won</strong><div className="muted">Requires a signed, countersigned, or active Agreement on the Organization.</div></article>
          <article className="request-card"><strong>Dormant</strong><div className="muted">Requires a Follow-Up Date so the opportunity resurfaces automatically.</div></article>
        </div>
      </OperationalDetailSection>

      {organizationDetail ? (
        <OperationalDetailSection title="Account Warning Signal" summary="Non-blocking Agreement posture from the connected client record." defaultOpen>
          <div className="detail-grid">
            <article className="request-card"><strong>Organization</strong><div className="muted">{organizationDetail.organization.display_name}</div></article>
            <article className="request-card"><strong>Active Agreement</strong><div className="muted">{organizationDetail.agreement_summary.has_active_agreement ? "Yes" : "No active Agreement on file"}</div></article>
            <article className="request-card"><strong>Pending Signature</strong><div className="muted">{organizationDetail.agreement_summary.has_pending_signature ? "Unsigned Agreement exists" : "No pending signature"}</div></article>
            <article className="request-card"><strong>Expiring / Expired</strong><div className="muted">{organizationDetail.agreement_summary.has_expiring_soon || organizationDetail.agreement_summary.has_expired ? "Agreement warning already active" : "No current Agreement warning"}</div></article>
          </div>
        </OperationalDetailSection>
      ) : null}
    </form>
  );
}

function buildSummaryCards(board: SalesPipelineBoardView | null, list: Awaited<ReturnType<typeof listSalesOpportunities>> | null) {
  const source = list?.summary ?? (board ? { ...board.summary, total: board.pipelines.reduce((count, pipeline) => count + pipeline.stage_columns.reduce((sum, column) => sum + column.opportunities.length, 0), 0) } : null);
  return [
    { label: "Total Opportunities", value: source?.total ?? "-", summary: "Current schools and sports relationship work under active management." },
    { label: "Active", value: source?.active ?? "-", summary: "Opportunities still moving through the pipeline." },
    { label: "Dormant", value: source?.dormant ?? "-", summary: "Paused opportunities waiting for scheduled resurfacing." },
    { label: "Resurfacing Soon", value: source?.resurfacing_soon ?? "-", summary: "Dormant follow-up dates approaching inside the alert window." },
    { label: "Next Action Overdue", value: source?.overdue_next_actions ?? "-", summary: "Active work with next-step dates already overdue." },
    { label: "Won", value: source?.won ?? "-", summary: "Closed opportunities with agreement-backed completion." },
    { label: "Lost", value: source?.lost ?? "-", summary: "Lost opportunities retained for relationship memory and later review." }
  ];
}

function buildAutomationCards(
  summary: SalesPipelineBoardView["automation_summary"] | Awaited<ReturnType<typeof listSalesOpportunities>>["automation_summary"] | null
) {
  return [
    { label: "Missing Next Action", value: summary?.missing_next_action ?? "-", summary: "Active opportunities missing a scheduled next step." },
    { label: "Inactive Opportunities", value: summary?.inactive_opportunities ?? "-", summary: "Opportunities stale beyond the inactivity window." },
    { label: "Meeting Alerts", value: summary?.meeting_scheduled ?? "-", summary: "Leadership notifications created when meetings are scheduled." },
    { label: "Contract Reminders Due", value: summary?.contract_reminders_due ?? "-", summary: "Unsigned agreements ready for the next reminder touch." },
    { label: "Renewals Due", value: summary?.renewals_due ?? "-", summary: "Agreement expirations entering the renewal reminder windows." },
    { label: "Upcoming Shoot Risk", value: summary?.upcoming_shoot_risk ?? "-", summary: "Upcoming shoots tied to missing, unsigned, or expired agreements." },
    { label: "Missing Active Agreement", value: summary?.accounts_missing_active_agreement ?? "-", summary: "Accounts with no active agreement on file right now." }
  ];
}

function buildLaneSummaryChips(pipeline: SalesPipelineLane): OperationalPreviewChip[] {
  return [
    { label: `${pipeline.summary.active} active`, tone: "info" },
    { label: `${pipeline.summary.dormant} dormant`, tone: "neutral" },
    { label: `${pipeline.summary.resurfacing_soon} resurfacing`, tone: pipeline.summary.resurfacing_soon ? "warning" : "neutral" },
    { label: `${pipeline.summary.overdue_next_actions} overdue`, tone: pipeline.summary.overdue_next_actions ? "critical" : "neutral" }
  ];
}

function buildOpportunityMeta(opportunity: SalesOpportunitySummary): OperationalPreviewChip[] {
  const chips: OperationalPreviewChip[] = [
    { label: labelForPipeline(opportunity.pipeline_type), tone: "info" },
    { label: labelForOpportunityType(opportunity.opportunity_type), tone: "neutral" }
  ];
  if (opportunity.primary_contact_name) {
    chips.push({ label: opportunity.primary_contact_name, tone: "neutral" });
  }
  if (opportunity.estimated_value !== null) {
    chips.push({ label: formatCurrency(opportunity.estimated_value), tone: "success" });
  }
  return chips;
}

function buildOpportunityFlags(opportunity: SalesOpportunitySummary): OperationalPreviewChip[] {
  const flags: OperationalPreviewChip[] = [];
  if (opportunity.open_alert_count > 0) {
    flags.push({ label: `${opportunity.open_alert_count} automation alert${opportunity.open_alert_count === 1 ? "" : "s"}`, tone: "critical" });
  }
  if (opportunity.next_action_missing) {
    flags.push({ label: "Next action missing", tone: "critical" });
  }
  if (opportunity.next_action_overdue) {
    flags.push({ label: "Next action overdue", tone: "critical" });
  }
  if (opportunity.resurface_ready) {
    flags.push({ label: "Dormant follow-up due", tone: "warning" });
  }
  if (opportunity.status === "won") {
    flags.push({ label: "Won", tone: "success" });
  }
  if (opportunity.status === "lost") {
    flags.push({ label: "Lost", tone: "neutral" });
  }
  if (opportunity.status === "dormant" && opportunity.follow_up_date) {
    flags.push({ label: `Follow up ${formatShortDate(opportunity.follow_up_date)}`, tone: "warning" });
  }
  return flags;
}

function formatNextAction(opportunity: SalesOpportunitySummary) {
  if (opportunity.status === "dormant" && opportunity.follow_up_date) {
    return `Resume ${formatShortDate(opportunity.follow_up_date)}`;
  }
  if (!opportunity.next_action_date) {
    return "Next action not scheduled";
  }
  return `Next action ${formatShortDate(opportunity.next_action_date)}`;
}

function toneForAttention(attentionState: SalesOpportunitySummary["attention_state"]): OperationalPreviewTone {
  if (attentionState === "critical") {
    return "critical";
  }
  if (attentionState === "warning") {
    return "warning";
  }
  return "neutral";
}

function buildEmptyForm(pipelineType: SalesPipelineType): OpportunityFormState {
  const today = new Date().toISOString().slice(0, 10);
  return {
    organizationId: "",
    primaryContactId: "",
    ownerId: "",
    opportunityType: "new",
    pipelineType,
    stage: "lead",
    estimatedValue: "",
    nextActionDate: today,
    lastTouchDate: today,
    lastVerifiedContactDate: "",
    followUpDate: "",
    notes: ""
  };
}

function mapOpportunityToForm(opportunity: SalesOpportunitySummary): OpportunityFormState {
  return {
    organizationId: opportunity.organization_id,
    primaryContactId: opportunity.primary_contact_id ?? "",
    ownerId: opportunity.owner_id,
    opportunityType: opportunity.opportunity_type,
    pipelineType: opportunity.pipeline_type,
    stage: opportunity.stage,
    estimatedValue: opportunity.estimated_value === null ? "" : String(opportunity.estimated_value),
    nextActionDate: opportunity.next_action_date ?? "",
    lastTouchDate: opportunity.last_touch_date,
    lastVerifiedContactDate: opportunity.last_verified_contact_date ?? "",
    followUpDate: opportunity.follow_up_date ?? "",
    notes: opportunity.notes ?? ""
  };
}

function getInitialPipelineForForm(pipelineFilter: SalesPipelineType | "all", allowedPipelineTypes: SalesPipelineType[]): SalesPipelineType {
  if (pipelineFilter !== "all") {
    return pipelineFilter;
  }
  if (allowedPipelineTypes.includes("schools")) {
    return "schools";
  }
  return allowedPipelineTypes[0] ?? "schools";
}

function parseNullableCurrency(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const numeric = Number(trimmed.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) {
    throw new Error("Estimated Value must be a valid number.");
  }
  return numeric;
}

function labelForStage(value: SalesOpportunityStage) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function labelForStatus(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function labelForPipeline(value: SalesPipelineType) {
  return value === "schools" ? "Schools Pipeline" : "Sports Pipeline";
}

function labelForOpportunityType(value: SalesOpportunityType) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function labelForAlertType(value: SalesPipelineAlertRecord["alert_type"]) {
  switch (value) {
    case "missing_next_action":
      return "Missing Next Action";
    case "inactive_opportunity":
      return "Inactive Opportunity";
    default:
      return "Meeting Scheduled";
  }
}

function labelForAlertSeverity(value: SalesPipelineAlertRecord["severity"]) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatCurrency(value: number | null) {
  if (value === null) {
    return "Not set";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function formatShortDate(value: string | null) {
  if (!value) {
    return "Not scheduled";
  }
  return new Date(`${value}T00:00:00`).toLocaleDateString();
}
