import { useEffect, useMemo, useState } from "react";
import type {
  ResourceLibraryApprovalStatus,
  ResourceLibraryBestReferenceCategory,
  ResourceLibraryCategory,
  ResourceLibraryItem,
  ResourceLibraryLearning,
  ResourceLibraryLinkedScope,
  ResourceLibraryView,
  ResourceLibraryVisibilityScope
} from "../types";
import { reviewResourceLibraryItem as reviewResourceLibraryItemRequest } from "../services/resourceLibraryApi";
import { OperationalDetailSection } from "./OperationalDetailSection";

type ResourceLibraryTab = "media" | "documents" | "historical_references" | "post_shoot_learnings";
type ResourceWindowFilter = "all" | "last_12_months" | "last_24_months" | "older_than_24_months";
type ResourceScopeFilter = "all" | ResourceLibraryLinkedScope;
type ResourceEntityFilter = "all" | string;
type ResourceFilterOption = {
  value: string;
  label: string;
};
type ResourceItemFilterState = {
  search: string;
  categoryFilter: ResourceLibraryCategory | "all";
  scopeFilter: ResourceScopeFilter;
  windowFilter: ResourceWindowFilter;
  uploaderFilter: string;
  issueFilter: string;
  organizationFilter: ResourceEntityFilter;
  locationFilter: ResourceEntityFilter;
  shootFilter: ResourceEntityFilter;
  shootDateFilter: ResourceEntityFilter;
};
type ResourceLearningFilterState = {
  search: string;
  windowFilter: ResourceWindowFilter;
  uploaderFilter: string;
  organizationFilter: ResourceEntityFilter;
  locationFilter: ResourceEntityFilter;
  shootFilter: ResourceEntityFilter;
  shootDateFilter: ResourceEntityFilter;
};
type RecurringReminder = {
  id: string;
  label: string;
  detail: string;
  created_at: string | null;
  shoot_name: string | null;
  shoot_date: string | null;
};
type RecurringShootSummary = {
  id: string;
  shoot_id: string | null;
  shoot_name: string;
  shoot_date: string;
  photographer_name: string;
  overall_rating: number;
};
type RecurringIntelligenceView = {
  whatToKnowNextTime: RecurringReminder[];
  mapsAccessReminders: RecurringReminder[];
  recurringContacts: NonNullable<ResourceLibraryView["recurring_location_intelligence"]>["recurring_contacts"];
  previousShoots: RecurringShootSummary[];
  bestReference: ResourceLibraryItem[];
  setupPhotos: ResourceLibraryItem[];
  priorSuccessfulExamples: ResourceLibraryItem[];
  productDesignExamples: ResourceLibraryItem[];
  locationReferences: ResourceLibraryItem[];
  qrJobDocs: ResourceLibraryItem[];
  evaluationHighlights: ResourceLibraryLearning[];
};
type BestReferenceCategoryCoverage = {
  category: ResourceLibraryBestReferenceCategory;
  label: string;
  count: number;
  remaining: number;
  items: ResourceLibraryItem[];
};

type Props = {
  library: ResourceLibraryView | null | undefined;
  scopeLabel: "Shoot" | "Organization" | "Location";
  defaultTab?: ResourceLibraryTab;
  token?: string;
};

type ResourceLibraryReviewFormState = {
  approval_status: ResourceLibraryApprovalStatus;
  visibility_scope: ResourceLibraryVisibilityScope;
  category: ResourceLibraryCategory;
  best_reference_candidate: boolean;
  is_best_reference: boolean;
  best_reference_category: ResourceLibraryBestReferenceCategory | "";
  review_note: string;
};

type ReviewConfig = {
  token: string;
  startExpanded?: boolean;
  onReviewed: (item: ResourceLibraryItem) => void;
  onError: (message: string) => void;
};

const RESOURCE_CATEGORY_OPTIONS: Array<{ value: ResourceLibraryCategory | "all"; label: string }> = [
  { value: "all", label: "All Categories" },
  { value: "setup_photo", label: "Setup Photo" },
  { value: "location_reference", label: "Location Reference" },
  { value: "prior_successful_example", label: "Prior Successful Example" },
  { value: "product_example", label: "Product Example" },
  { value: "issue_concern", label: "Issue / Concern" },
  { value: "equipment_setup_need", label: "Equipment / Setup Need" },
  { value: "qr_code_job_document", label: "QR Code / Job Document" },
  { value: "sop_reference", label: "SOP / Reference" },
  { value: "contract_document", label: "Contract / Agreement" },
  { value: "proof_document", label: "Proof / Review Document" },
  { value: "support_document", label: "Support Document" },
  { value: "misc_internal_reference", label: "Misc Internal Reference" }
];

const RESOURCE_APPROVAL_OPTIONS: Array<{ value: ResourceLibraryApprovalStatus; label: string }> = [
  { value: "pending_review", label: "Pending Review" },
  { value: "approved", label: "Approved for Future Reference" },
  { value: "leadership_only", label: "Leadership Only" },
  { value: "rejected_not_useful", label: "Rejected / Not Useful" }
];

const RESOURCE_VISIBILITY_OPTIONS: Array<{ value: ResourceLibraryVisibilityScope; label: string }> = [
  { value: "photographer_prep", label: "Photographer Prep" },
  { value: "leadership_only", label: "Leadership Only" }
];

const BEST_REFERENCE_CATEGORY_OPTIONS: Array<{ value: ResourceLibraryBestReferenceCategory; label: string }> = [
  { value: "best_setup_example", label: "Best Setup Example" },
  { value: "best_team_photo_example", label: "Best Team-Photo Example" },
  { value: "best_entrance_location_example", label: "Best Entrance / Location Example" },
  { value: "best_product_poster_example", label: "Best Product / Poster Example" },
  { value: "best_logistics_example", label: "Best Logistics Example" }
];

export function ResourceLibraryPanel({ library, scopeLabel, defaultTab = "media", token }: Props) {
  const [activeTab, setActiveTab] = useState<ResourceLibraryTab>(defaultTab);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ResourceLibraryCategory | "all">("all");
  const [scopeFilter, setScopeFilter] = useState<ResourceScopeFilter>("all");
  const [windowFilter, setWindowFilter] = useState<ResourceWindowFilter>("all");
  const [uploaderFilter, setUploaderFilter] = useState("all");
  const [issueFilter, setIssueFilter] = useState("all");
  const [organizationFilter, setOrganizationFilter] = useState<ResourceEntityFilter>("all");
  const [locationFilter, setLocationFilter] = useState<ResourceEntityFilter>("all");
  const [shootFilter, setShootFilter] = useState<ResourceEntityFilter>("all");
  const [shootDateFilter, setShootDateFilter] = useState<ResourceEntityFilter>("all");
  const [libraryState, setLibraryState] = useState<ResourceLibraryView | null | undefined>(library);
  const [reviewNotice, setReviewNotice] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [previewItem, setPreviewItem] = useState<ResourceLibraryItem | null>(null);

  useEffect(() => {
    setLibraryState(library);
  }, [library]);

  const resourceItems = useMemo(() => (libraryState ? allResourceItems(libraryState) : []), [libraryState]);

  const uploaderOptions = useMemo(() => {
    const values = new Set<string>();
    for (const item of resourceItems) {
      if (item.uploader_name) {
        values.add(item.uploader_name);
      }
    }
    for (const learning of libraryState?.post_shoot_learnings ?? []) {
      if (learning.photographer_name) {
        values.add(learning.photographer_name);
      }
    }
    return [...values].sort((left, right) => left.localeCompare(right));
  }, [libraryState?.post_shoot_learnings, resourceItems]);

  const issueOptions = useMemo(() => {
    const values = new Set<string>();
    for (const item of resourceItems) {
      if (item.issue_type) {
        values.add(item.issue_type);
      }
    }
    return [...values].sort((left, right) => left.localeCompare(right));
  }, [resourceItems]);

  const organizationOptions = useMemo(
    () =>
      buildResourceFilterOptions([
        ...resourceItems.map((item) =>
          item.organization_id
            ? {
                value: item.organization_id,
                label: item.organization_display_name ?? "Unnamed Organization"
              }
            : null
        ),
        ...(libraryState?.post_shoot_learnings ?? []).map((learning) =>
          learning.organization_id
            ? {
                value: learning.organization_id,
                label: learning.organization_display_name ?? "Unnamed Organization"
              }
            : null
        )
      ]),
    [libraryState?.post_shoot_learnings, resourceItems]
  );

  const locationOptions = useMemo(
    () =>
      buildResourceFilterOptions([
        ...resourceItems.map((item) =>
          item.location_id
            ? {
                value: item.location_id,
                label: item.location_name ?? "Unnamed Location"
              }
            : null
        ),
        ...(libraryState?.post_shoot_learnings ?? []).map((learning) =>
          learning.location_id
            ? {
                value: learning.location_id,
                label: learning.location_name ?? "Unnamed Location"
              }
            : null
        )
      ]),
    [libraryState?.post_shoot_learnings, resourceItems]
  );

  const shootOptions = useMemo(
    () =>
      buildResourceFilterOptions([
        ...resourceItems.map((item) =>
          item.shoot_id
            ? {
                value: item.shoot_id,
                label: buildShootLabel(item.shoot_code, item.shoot_title)
              }
            : null
        ),
        ...(libraryState?.post_shoot_learnings ?? []).map((learning) =>
          learning.shoot_id
            ? {
                value: learning.shoot_id,
                label: learning.shoot_name
              }
            : null
        )
      ]),
    [libraryState?.post_shoot_learnings, resourceItems]
  );

  const shootDateOptions = useMemo(() => {
    const values = new Set<string>();
    for (const item of resourceItems) {
      if (item.shoot_date) {
        values.add(item.shoot_date);
      }
    }
    for (const learning of libraryState?.post_shoot_learnings ?? []) {
      if (learning.shoot_date) {
        values.add(learning.shoot_date);
      }
    }
    return [...values].sort((left, right) => new Date(right).getTime() - new Date(left).getTime());
  }, [libraryState?.post_shoot_learnings, resourceItems]);

  const itemFilters: ResourceItemFilterState = {
    search,
    categoryFilter,
    scopeFilter,
    windowFilter,
    uploaderFilter,
    issueFilter,
    organizationFilter,
    locationFilter,
    shootFilter,
    shootDateFilter
  };

  const learningFilters: ResourceLearningFilterState = {
    search,
    windowFilter,
    uploaderFilter,
    organizationFilter,
    locationFilter,
    shootFilter,
    shootDateFilter
  };

  const filteredPrepHighlights = useMemo(
    () => (libraryState?.prep_highlights ?? []).filter((item) => matchesResourceItemFilters(item, itemFilters)),
    [itemFilters, libraryState?.prep_highlights]
  );

  const filteredMedia = useMemo(
    () => (libraryState?.media ?? []).filter((item) => matchesResourceItemFilters(item, itemFilters)),
    [itemFilters, libraryState?.media]
  );

  const filteredDocuments = useMemo(
    () => (libraryState?.documents ?? []).filter((item) => matchesResourceItemFilters(item, itemFilters)),
    [itemFilters, libraryState?.documents]
  );

  const filteredHistoricalReferences = useMemo(
    () => (libraryState?.historical_references ?? []).filter((item) => matchesResourceItemFilters(item, itemFilters)),
    [itemFilters, libraryState?.historical_references]
  );

  const filteredLearnings = useMemo(
    () => (libraryState?.post_shoot_learnings ?? []).filter((learning) => matchesLearningFilters(learning, learningFilters)),
    [learningFilters, libraryState?.post_shoot_learnings]
  );

  const filteredAllItems = useMemo(
    () => resourceItems.filter((item) => matchesResourceItemFilters(item, itemFilters)),
    [itemFilters, resourceItems]
  );

  const recurringIntelligence = useMemo(
    () => buildRecurringIntelligenceView(libraryState, filteredAllItems, filteredLearnings),
    [filteredAllItems, filteredLearnings, libraryState]
  );

  const shootResourceCenterSections = useMemo(
    () => (scopeLabel === "Shoot" ? buildShootResourceCenterSections(filteredAllItems) : []),
    [filteredAllItems, scopeLabel]
  );

  const filteredReviewQueue = useMemo(
    () => (libraryState?.review_queue ?? []).filter((item) => matchesResourceItemFilters(item, itemFilters)),
    [libraryState?.review_queue, itemFilters]
  );

  if (!libraryState) {
    return <div className="empty-state empty-state--panel">Resource Library is not available on this {scopeLabel} yet.</div>;
  }

  const currentLibrary = libraryState;

  function handleReviewedItem(updatedItem: ResourceLibraryItem) {
    setLibraryState((current) => (current ? updateResourceLibraryView(current, updatedItem) : current));
    setReviewError("");
    setReviewNotice(`${updatedItem.file_name} was updated for future prep visibility.`);
  }

  const currentItems =
    activeTab === "media"
      ? filteredMedia
      : activeTab === "documents"
        ? filteredDocuments
        : activeTab === "historical_references"
          ? filteredHistoricalReferences
          : [];

  const approvedPrepMaterials = filteredAllItems.filter(
    (item) => item.approval_status === "approved" && item.visibility_scope === "photographer_prep"
  );
  const pendingRawUploads = filteredReviewQueue.filter((item) => item.approval_status === "pending_review");
  const bestReferenceCoverage = buildBestReferenceCategoryCoverage(filteredAllItems);
  const intelligenceSummary = buildRecurringIntelligenceSummary(scopeLabel);
  const previousShootsLabel = scopeLabel === "Organization" ? "Previous Shoots for This Organization" : "Previous Shoots at This Location";

  return (
    <div className="resource-library">
      <div className="resource-library__summary">
        <article className="resource-library__summary-card request-card">
          <span className="eyebrow">{scopeLabel === "Shoot" ? "Shoot Resource Center" : "Prep Highlights"}</span>
          <strong>{currentLibrary.summary.prep_highlight_count}</strong>
          <div className="muted">
            {scopeLabel === "Shoot"
              ? "Prior wins, setup context, location references, and job docs stay organized around this Shoot."
              : "Best Reference, prior wins, setup context, and job docs stay surfaced in one shared Resource Library."}
          </div>
        </article>
        <article className="resource-library__summary-card request-card">
          <span className="eyebrow">Media</span>
          <strong>{currentLibrary.summary.media_count}</strong>
          <div className="muted">Setup photos, references, and internal examples linked to this record.</div>
        </article>
        <article className="resource-library__summary-card request-card">
          <span className="eyebrow">Documents</span>
          <strong>{currentLibrary.summary.document_count}</strong>
          <div className="muted">PDFs, QR codes, and job documents kept inside the same library.</div>
        </article>
        <article className="resource-library__summary-card request-card">
          <span className="eyebrow">Best Reference</span>
          <strong>{currentLibrary.summary.best_reference_count}</strong>
          <div className="muted">Leadership-approved examples that stay visible even when they are older.</div>
        </article>
      </div>

      <div className="resource-library__banner">
        <div className={`feedback-strip feedback-strip--${currentLibrary.access.limited_view ? "info" : "neutral"}`}>
          <div className="feedback-strip__content">
            <strong>{currentLibrary.access.limited_view ? "Photographer prep view" : "Leadership management view"}</strong>
            <div>
              {currentLibrary.access.limited_view
                ? `Showing approved prep materials from the last ${currentLibrary.access.historical_window_years ?? 2} years, plus all Best Reference items.`
                : "Showing all linked Resource Library history for this record, including leadership-only items and older prep context."}
            </div>
          </div>
        </div>
      </div>

      <OperationalDetailSection
        title="Retrieval Lanes"
        summary="Raw uploads, approved prep materials, documents, and historical references stay separated so prep teams can find what matters without digging through the whole archive."
      >
        <div className="detail-two-column">
          <article className="request-card">
            <strong>Raw Upload Review Queue</strong>
            <div className="muted">
              {pendingRawUploads.length} item{pendingRawUploads.length === 1 ? "" : "s"} currently need leadership review before they become reusable prep memory.
            </div>
          </article>
          <article className="request-card">
            <strong>Approved Prep Materials</strong>
            <div className="muted">
              {approvedPrepMaterials.length} approved prep item{approvedPrepMaterials.length === 1 ? "" : "s"} are ready for contextual photographer viewing.
            </div>
          </article>
          <article className="request-card">
            <strong>Documents / PDFs</strong>
            <div className="muted">
              {filteredDocuments.length} document{filteredDocuments.length === 1 ? "" : "s"} remain distinct from visual prep materials so QR files and job docs do not get buried.
            </div>
          </article>
          <article className="request-card">
            <strong>Historical References</strong>
            <div className="muted">
              {filteredHistoricalReferences.length} historical reference{filteredHistoricalReferences.length === 1 ? "" : "s"} are available for lookback without mixing them into raw upload review.
            </div>
          </article>
        </div>
      </OperationalDetailSection>

      {currentLibrary.access.can_manage && token ? (
        <OperationalDetailSection
          title="Approval Workflow"
          summary="Leadership decides what becomes reusable next year, what stays leadership-only, what is rejected, and which items become Best Reference."
        >
          {reviewError ? <div className="error-banner">{reviewError}</div> : null}
          {reviewNotice ? <div className="live-banner">{reviewNotice}</div> : null}
          <div className="detail-two-column">
            <article className="request-card">
              <strong>Pending Review</strong>
              <div className="muted">{currentLibrary.summary.pending_review_count} items still need an approval decision.</div>
            </article>
            <article className="request-card">
              <strong>Leadership Only</strong>
              <div className="muted">{currentLibrary.summary.leadership_only_count} items stay contextual and hidden from photographer prep.</div>
            </article>
            <article className="request-card">
              <strong>Rejected / Not Useful</strong>
              <div className="muted">{currentLibrary.summary.rejected_count} items are retained for leadership but removed from prep memory surfaces.</div>
            </article>
            <article className="request-card">
              <strong>Best Reference</strong>
              <div className="muted">
                {currentLibrary.summary.best_reference_count} curated items are live. Mission Control allows up to 3 Best Reference items per category in the current prep scope.
              </div>
            </article>
          </div>

          <section className="feedback-strip feedback-strip--info">
            <div className="feedback-strip__content">
              <strong>Retention and visibility rules</strong>
              <div>Leadership retains the full history. Photographers only get approved prep content from the last 2 years, plus older Best Reference items.</div>
              <div className="muted">Preview-first viewing stays contextual. Download access is kept off the photographer surface by default.</div>
            </div>
          </section>

          <div className="resource-library__best-reference-heading">
            <strong>Best Reference Category Coverage</strong>
            <div className="muted">Leadership can curate up to 3 retained examples per category for this prep scope.</div>
          </div>

          <div className="resource-library__best-reference-grid">
            {bestReferenceCoverage.map((coverage) => (
              <article key={coverage.category} className="request-card resource-library__best-reference-card">
                <div className="resource-library__prep-lane-head">
                  <span className="eyebrow">{coverage.label}</span>
                  <strong>
                    {coverage.count} / 3
                  </strong>
                </div>
                <div className="muted">
                  {coverage.count
                    ? `${coverage.remaining} slot${coverage.remaining === 1 ? "" : "s"} still open for this Best Reference category.`
                    : "No current Best Reference items are pinned in this category yet."}
                </div>
                {coverage.items.length ? (
                  <div className="resource-library__best-reference-list">
                    {coverage.items.map((item) => (
                      <button
                        key={item.id}
                        className="resource-library__best-reference-item"
                        type="button"
                        onClick={() => setPreviewItem(item)}
                      >
                        <strong>{item.file_name}</strong>
                        <span>{humanizeCategory(item.category)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          <div className="resource-library__grid">
            {filteredReviewQueue.map((item) => (
              <ResourceItemCard
                key={item.id}
                item={item}
                canDownload={currentLibrary.access.can_download}
                onPreview={setPreviewItem}
                reviewConfig={{
                  token,
                  startExpanded: true,
                  onReviewed: handleReviewedItem,
                  onError: setReviewError
                }}
              />
            ))}
            {!filteredReviewQueue.length ? (
              <div className="empty-state empty-state--panel">
                No pending-review or Best Reference candidate items match the current filters for this {scopeLabel}.
              </div>
            ) : null}
          </div>
        </OperationalDetailSection>
      ) : null}

      <OperationalDetailSection title="Recurring Location Intelligence" summary={intelligenceSummary}>
        <div className="field-grid field-grid--compact resource-library__filters">
          <label className="filter-field filter-field--wide">
            <span>Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="File name, note, organization, location, shoot, or uploader"
            />
          </label>
          <label className="filter-field">
            <span>Category</span>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as ResourceLibraryCategory | "all")}>
              {RESOURCE_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Scope</span>
            <select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as ResourceScopeFilter)}>
              <option value="all">All Linked Scope</option>
              <option value="shoot">Shoot</option>
              <option value="location">Location</option>
              <option value="organization">Organization</option>
            </select>
          </label>
          <label className="filter-field">
            <span>Date Window</span>
            <select value={windowFilter} onChange={(event) => setWindowFilter(event.target.value as ResourceWindowFilter)}>
              <option value="all">All Dates</option>
              <option value="last_12_months">Last 12 Months</option>
              <option value="last_24_months">Last 24 Months</option>
              <option value="older_than_24_months">Older Than 24 Months</option>
            </select>
          </label>
          <label className="filter-field">
            <span>Shoot Date</span>
            <select value={shootDateFilter} onChange={(event) => setShootDateFilter(event.target.value)}>
              <option value="all">All Shoot Dates</option>
              {shootDateOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Uploader / Photographer</span>
            <select value={uploaderFilter} onChange={(event) => setUploaderFilter(event.target.value)}>
              <option value="all">All Uploaders</option>
              {uploaderOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Issue Type</span>
            <select value={issueFilter} onChange={(event) => setIssueFilter(event.target.value)}>
              <option value="all">All Issue Types</option>
              {issueOptions.map((option) => (
                <option key={option} value={option}>
                  {humanizeLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Organization</span>
            <select value={organizationFilter} onChange={(event) => setOrganizationFilter(event.target.value)}>
              <option value="all">All Organizations</option>
              {organizationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Location</span>
            <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
              <option value="all">All Locations</option>
              {locationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Shoot</span>
            <select value={shootFilter} onChange={(event) => setShootFilter(event.target.value)}>
              <option value="all">All Shoots</option>
              {shootOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="resource-library__intelligence-summary">
          <RecurringIntelligenceListCard
            title="What To Know Next Time"
            summary="Operational watchouts, setup notes, and evaluation guidance pulled forward for the next crew."
            items={recurringIntelligence.whatToKnowNextTime}
            emptyMessage={`No recurring reminders match the current filters for this ${scopeLabel}.`}
          />
          <RecurringContactCard
            title="Recurring Contacts"
            summary="People this team is likely to work with again at this organization and location."
            contacts={recurringIntelligence.recurringContacts}
            emptyMessage={`No recurring contacts are available for this ${scopeLabel} yet.`}
          />
          <RecurringIntelligenceListCard
            title="Maps / Access Reminders"
            summary="Access paths, timing cautions, and site-specific arrival notes from prior Post-Shoot Evaluations."
            items={recurringIntelligence.mapsAccessReminders}
            emptyMessage={`No maps or access reminders match the current filters for this ${scopeLabel}.`}
          />
          <RecurringPreviousShootsCard
            title={previousShootsLabel}
            summary="Historical shoots at this prep context, surfaced so leadership and crews can trace what happened here before."
            shoots={recurringIntelligence.previousShoots}
            emptyMessage={`No previous shoots match the current filters for this ${scopeLabel}.`}
          />
        </div>

        <div className="resource-library__prep-center">
          <ResourceLane
            title="Prior Setup Photos"
            summary="Setup and staging reference from prior shoots so the team can rebuild what worked."
            items={recurringIntelligence.setupPhotos}
            canDownload={currentLibrary.access.can_download}
            onPreview={setPreviewItem}
            emptyMessage={`No setup photos match the current filters for this ${scopeLabel}.`}
          />
          <ResourceLane
            title="Prior Successful Examples"
            summary="Examples of strong coverage that show what success looked like in prior years."
            items={recurringIntelligence.priorSuccessfulExamples}
            canDownload={currentLibrary.access.can_download}
            onPreview={setPreviewItem}
            emptyMessage={`No prior successful examples match the current filters for this ${scopeLabel}.`}
          />
          <ResourceLane
            title="Product / Design Examples"
            summary="Product examples that help the crew understand output expectations before the next shoot."
            items={recurringIntelligence.productDesignExamples}
            canDownload={currentLibrary.access.can_download}
            onPreview={setPreviewItem}
            emptyMessage={`No product or design examples match the current filters for this ${scopeLabel}.`}
          />
          <ResourceLane
            title="Location References"
            summary="Entrances, unload points, and physical wayfinding context that matter when arriving onsite."
            items={recurringIntelligence.locationReferences}
            canDownload={currentLibrary.access.can_download}
            onPreview={setPreviewItem}
            emptyMessage={`No location references match the current filters for this ${scopeLabel}.`}
          />
          <ResourceLane
            title="QR / Job Docs"
            summary="QR packets, PDFs, and operational job documents that should travel with future prep."
            items={recurringIntelligence.qrJobDocs}
            canDownload={currentLibrary.access.can_download}
            onPreview={setPreviewItem}
            emptyMessage={`No QR or job documents match the current filters for this ${scopeLabel}.`}
          />
          <ResourceLane
            title="Best Reference"
            summary="Leadership-curated Best Reference items stay visible across years, with up to three examples per category."
            items={recurringIntelligence.bestReference}
            canDownload={currentLibrary.access.can_download}
            onPreview={setPreviewItem}
            emptyMessage={`No Best Reference items match the current filters for this ${scopeLabel}.`}
          />
        </div>

        <div className="resource-library__learning-list">
          {recurringIntelligence.evaluationHighlights.map((learning) => (
            <LearningCard key={learning.id} learning={learning} />
          ))}
          {!recurringIntelligence.evaluationHighlights.length ? (
            <div className="empty-state empty-state--panel">
              No prior Post-Shoot Evaluation highlights match the current filters for this {scopeLabel}.
            </div>
          ) : null}
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection
        title={scopeLabel === "Shoot" ? "Shoot Resource Center" : "Prep Highlights"}
        summary={
          scopeLabel === "Shoot"
            ? "The most relevant operational prep materials for this Shoot, grouped in the order the team usually needs them."
            : `The most relevant materials for getting ready before the team leaves for this ${scopeLabel}.`
        }
        defaultOpen
      >
        {scopeLabel === "Shoot" ? (
          <div className="resource-library__prep-center">
            {shootResourceCenterSections.map((section) => (
              <article key={section.key} className="resource-library__prep-lane request-card">
                <div className="resource-library__prep-lane-head">
                  <span className="eyebrow">{section.title}</span>
                  <strong>{section.items.length}</strong>
                </div>
                <div className="muted">{section.summary}</div>
                <div className="resource-library__prep-lane-items">
                  {section.items.length ? (
                    section.items.map((item) => (
                      <ResourceItemCard
                        key={item.id}
                        item={item}
                        canDownload={currentLibrary.access.can_download}
                        onPreview={setPreviewItem}
                        compact
                      />
                    ))
                  ) : (
                    <div className="empty-state empty-state--panel">
                      No {section.title.toLowerCase()} match the current filters for this Shoot.
                    </div>
                  )}
                </div>
              </article>
            ))}
            <article className="resource-library__prep-lane request-card">
                <div className="resource-library__prep-lane-head">
                  <span className="eyebrow">Best Reference</span>
                  <strong>{currentLibrary.summary.best_reference_count}</strong>
                </div>
              <div className="muted">
                Best Reference curation stays visible in recurring intelligence today and can deepen into stronger prep workflows as approval rules expand.
              </div>
            </article>
          </div>
        ) : (
          <div className="resource-library__highlights">
            {filteredPrepHighlights.map((item) => (
              <ResourceItemCard
                key={item.id}
                item={item}
                canDownload={currentLibrary.access.can_download}
                onPreview={setPreviewItem}
                compact
              />
            ))}
            {!filteredPrepHighlights.length ? (
              <div className="empty-state empty-state--panel">No prep materials match the current filters for this {scopeLabel}.</div>
            ) : null}
          </div>
        )}
      </OperationalDetailSection>

      <div className="report-tab-row resource-library__tabs">
        <button className={activeTab === "media" ? "is-active" : ""} onClick={() => setActiveTab("media")}>
          Media
        </button>
        <button className={activeTab === "documents" ? "is-active" : ""} onClick={() => setActiveTab("documents")}>
          Documents
        </button>
        <button className={activeTab === "historical_references" ? "is-active" : ""} onClick={() => setActiveTab("historical_references")}>
          Historical References
        </button>
        <button className={activeTab === "post_shoot_learnings" ? "is-active" : ""} onClick={() => setActiveTab("post_shoot_learnings")}>
          Post-Shoot Learnings
        </button>
      </div>

      {activeTab === "post_shoot_learnings" ? (
        <OperationalDetailSection
          title="Post-Shoot Learnings"
          summary="Recent learnings and recommendations pulled forward into the same Resource Library experience."
          defaultOpen
        >
          <div className="resource-library__learning-list">
            {filteredLearnings.map((learning) => (
              <LearningCard key={learning.id} learning={learning} />
            ))}
            {!filteredLearnings.length ? (
              <div className="empty-state empty-state--panel">
                No Post-Shoot learnings match the current filters for this {scopeLabel}.
              </div>
            ) : null}
          </div>
        </OperationalDetailSection>
      ) : (
        <OperationalDetailSection
          title={activeTab === "media" ? "Media" : activeTab === "documents" ? "Documents" : "Historical References"}
          summary={buildTabSummary(activeTab, currentItems.length, scopeLabel)}
          defaultOpen
        >
          <div className="resource-library__grid">
            {currentItems.map((item) => (
              <ResourceItemCard
                key={item.id}
                item={item}
                canDownload={currentLibrary.access.can_download}
                onPreview={setPreviewItem}
                reviewConfig={
                  currentLibrary.access.can_manage && token
                    ? {
                        token,
                        onReviewed: handleReviewedItem,
                        onError: setReviewError
                      }
                    : undefined
                }
              />
            ))}
            {!currentItems.length ? (
              <div className="empty-state empty-state--panel">
                No {humanizeTabLabel(activeTab).toLowerCase()} match the current filters for this {scopeLabel}.
              </div>
            ) : null}
          </div>
        </OperationalDetailSection>
      )}

      <ResourcePreviewDialog
        item={previewItem}
        canDownload={currentLibrary.access.can_download}
        limitedView={currentLibrary.access.limited_view}
        onClose={() => setPreviewItem(null)}
      />
    </div>
  );
}

function ResourceLane({
  title,
  summary,
  items,
  canDownload,
  onPreview,
  emptyMessage
}: {
  title: string;
  summary: string;
  items: ResourceLibraryItem[];
  canDownload: boolean;
  onPreview: (item: ResourceLibraryItem) => void;
  emptyMessage: string;
}) {
  return (
    <article className="resource-library__prep-lane request-card">
      <div className="resource-library__prep-lane-head">
        <span className="eyebrow">{title}</span>
        <strong>{items.length}</strong>
      </div>
      <div className="muted">{summary}</div>
      <div className="resource-library__prep-lane-items">
        {items.length ? (
          items.map((item) => (
            <ResourceItemCard key={item.id} item={item} canDownload={canDownload} onPreview={onPreview} compact />
          ))
        ) : (
          <div className="empty-state empty-state--panel">{emptyMessage}</div>
        )}
      </div>
    </article>
  );
}

function RecurringIntelligenceListCard({
  title,
  summary,
  items,
  emptyMessage
}: {
  title: string;
  summary: string;
  items: RecurringReminder[];
  emptyMessage: string;
}) {
  return (
    <article className="resource-library__intelligence-card request-card">
      <div className="resource-library__prep-lane-head">
        <span className="eyebrow">{title}</span>
        <strong>{items.length}</strong>
      </div>
      <div className="muted">{summary}</div>
      {items.length ? (
        <div className="resource-library__intelligence-list">
          {items.map((item) => (
            <div key={item.id} className="resource-library__intelligence-item">
              <strong>{item.label}</strong>
              <div>{item.detail}</div>
              <div className="muted">
                {[item.shoot_name, item.shoot_date].filter(Boolean).join(" | ") || formatTimestamp(item.created_at)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state empty-state--panel">{emptyMessage}</div>
      )}
    </article>
  );
}

function RecurringContactCard({
  title,
  summary,
  contacts,
  emptyMessage
}: {
  title: string;
  summary: string;
  contacts: NonNullable<ResourceLibraryView["recurring_location_intelligence"]>["recurring_contacts"];
  emptyMessage: string;
}) {
  return (
    <article className="resource-library__intelligence-card request-card">
      <div className="resource-library__prep-lane-head">
        <span className="eyebrow">{title}</span>
        <strong>{contacts.length}</strong>
      </div>
      <div className="muted">{summary}</div>
      {contacts.length ? (
        <div className="resource-library__intelligence-list">
          {contacts.map((contact) => (
            <div key={contact.id} className="resource-library__intelligence-item">
              <strong>{contact.full_name}</strong>
              <div>{contact.title ?? "Title not captured yet"}</div>
              <div className="muted">{[contact.phone, contact.email].filter(Boolean).join(" | ") || "No direct contact details yet"}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state empty-state--panel">{emptyMessage}</div>
      )}
    </article>
  );
}

function RecurringPreviousShootsCard({
  title,
  summary,
  shoots,
  emptyMessage
}: {
  title: string;
  summary: string;
  shoots: RecurringShootSummary[];
  emptyMessage: string;
}) {
  return (
    <article className="resource-library__intelligence-card request-card">
      <div className="resource-library__prep-lane-head">
        <span className="eyebrow">{title}</span>
        <strong>{shoots.length}</strong>
      </div>
      <div className="muted">{summary}</div>
      {shoots.length ? (
        <div className="resource-library__intelligence-list">
          {shoots.map((shoot) => (
            <div key={shoot.id} className="resource-library__intelligence-item">
              <strong>{shoot.shoot_name}</strong>
              <div>
                {shoot.shoot_date} | {shoot.photographer_name}
              </div>
              <div className="muted">Overall rating {shoot.overall_rating}/5</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state empty-state--panel">{emptyMessage}</div>
      )}
    </article>
  );
}

function ResourceItemCard({
  item,
  canDownload,
  onPreview,
  compact = false,
  reviewConfig
}: {
  item: ResourceLibraryItem;
  canDownload: boolean;
  onPreview?: (item: ResourceLibraryItem) => void;
  compact?: boolean;
  reviewConfig?: ReviewConfig;
}) {
  const [reviewExpanded, setReviewExpanded] = useState(Boolean(reviewConfig?.startExpanded));
  const [savingReview, setSavingReview] = useState(false);
  const [reviewForm, setReviewForm] = useState<ResourceLibraryReviewFormState>(() => createReviewFormState(item));
  const hasImagePreview = item.resource_type === "image" && Boolean(item.preview_url);

  useEffect(() => {
    setReviewForm(createReviewFormState(item));
  }, [item]);

  useEffect(() => {
    if (reviewConfig?.startExpanded) {
      setReviewExpanded(true);
    }
  }, [reviewConfig?.startExpanded]);

  async function saveReview() {
    if (!reviewConfig?.token) {
      return;
    }
    setSavingReview(true);
    try {
      const approvalStatus = reviewForm.is_best_reference ? "approved" : reviewForm.approval_status;
      const visibilityScope =
        reviewForm.approval_status === "rejected_not_useful"
          ? "leadership_only"
          : reviewForm.is_best_reference
            ? "photographer_prep"
            : reviewForm.visibility_scope;
      const updated = await reviewResourceLibraryItemRequest(reviewConfig.token, item.id, {
        approval_status: approvalStatus,
        visibility_scope: visibilityScope,
        category: reviewForm.category,
        best_reference_candidate: reviewForm.best_reference_candidate,
        is_best_reference: reviewForm.is_best_reference,
        best_reference_category: reviewForm.is_best_reference ? reviewForm.best_reference_category || null : null,
        review_note: reviewForm.review_note.trim() || null
      });
      reviewConfig.onReviewed(updated);
      setReviewExpanded(Boolean(reviewConfig.startExpanded));
    } catch (error) {
      reviewConfig.onError(error instanceof Error ? error.message : "We couldn't save this Resource Library review.");
    } finally {
      setSavingReview(false);
    }
  }

  return (
    <article className={`resource-library__card request-card${compact ? " resource-library__card--compact" : ""}`}>
      <div className="resource-library__card-meta">
        <span className={`meta-pill meta-pill--${item.is_best_reference ? "identity" : "default"}`}>
          {item.is_best_reference ? "Best Reference" : humanizeCategory(item.category)}
        </span>
        <span className="meta-pill">{humanizeLinkedScope(item.linked_scope)}</span>
        <span className="meta-pill">{humanizeVisibilityScope(item.visibility_scope)}</span>
        <span
          className={`meta-pill meta-pill--${
            item.approval_status === "approved" ? "good" : item.approval_status === "pending_review" ? "warning" : "default"
          }`}
        >
          {humanizeApprovalStatus(item.approval_status)}
        </span>
        {item.is_best_reference && item.best_reference_category ? (
          <span className="meta-pill meta-pill--good">{humanizeBestReferenceCategory(item.best_reference_category)}</span>
        ) : null}
      </div>
      {hasImagePreview ? (
        <div className="resource-library__preview">
          <img src={item.preview_url!} alt={item.file_name} />
        </div>
      ) : null}
      <strong>{item.file_name}</strong>
      <div className="muted">{buildResourceSummaryLine(item)}</div>
      {item.note ? <p className="resource-library__note">{item.note}</p> : null}
      <div className="resource-library__footnote">
        {item.uploader_name ? <span>Uploaded by {item.uploader_name}</span> : null}
        <span>{formatTimestamp(item.captured_at ?? item.created_at)}</span>
      </div>
      <div className="resource-library__footnote">
        {item.organization_display_name ? <span>{item.organization_display_name}</span> : null}
        {item.location_name ? <span>{item.location_name}</span> : null}
        {item.shoot_code ? <span>{item.shoot_code}</span> : null}
      </div>
      {!compact && (item.upload_source || item.reviewed_at || item.review_note) ? (
        <div className="resource-library__review-summary">
          {item.upload_source ? <div className="muted">Upload source: {humanizeUploadSource(item.upload_source)}</div> : null}
          {item.reviewed_at ? (
            <div className="muted">
              Reviewed {formatTimestamp(item.reviewed_at)}
              {item.reviewed_by_name ? ` by ${item.reviewed_by_name}` : ""}
            </div>
          ) : null}
          {item.review_note ? <div className="resource-library__review-note">Review note: {item.review_note}</div> : null}
        </div>
      ) : null}
      <div className="resource-library__actions">
        <button className="secondary-button" type="button" onClick={() => onPreview?.(item)}>
          Preview
        </button>
        {canDownload && item.download_url ? (
          <a className="secondary-button" href={item.download_url} target="_blank" rel="noreferrer">
            Download
          </a>
        ) : null}
        {reviewConfig && !compact ? (
          <button className="secondary-button" onClick={() => setReviewExpanded((current) => !current)}>
            {reviewExpanded ? "Close Review" : "Review / Reclassify"}
          </button>
        ) : null}
      </div>
      {!canDownload && !compact ? (
        <div className="resource-library__guardrail muted">
          Contextual preview only. Download stays leadership-only on photographer prep surfaces.
        </div>
      ) : null}
      {reviewConfig && reviewExpanded ? (
        <div className="dashboard-stack dashboard-stack--tight">
          <div className="field-grid field-grid--compact">
            <label className="filter-field">
              <span>Approval Status</span>
              <select
                value={reviewForm.approval_status}
                onChange={(event) =>
                  setReviewForm((current) => applyApprovalStatusToReviewForm(current, event.target.value as ResourceLibraryApprovalStatus))
                }
              >
                {RESOURCE_APPROVAL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Category</span>
              <select
                value={reviewForm.category}
                onChange={(event) => setReviewForm((current) => ({ ...current, category: event.target.value as ResourceLibraryCategory }))}
              >
                {RESOURCE_CATEGORY_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Visibility</span>
              <select
                value={reviewForm.visibility_scope}
                onChange={(event) =>
                  setReviewForm((current) => ({ ...current, visibility_scope: event.target.value as ResourceLibraryVisibilityScope }))
                }
                disabled={reviewForm.approval_status === "rejected_not_useful"}
              >
                {RESOURCE_VISIBILITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {item.resource_type === "image" ? (
            <div className="field-grid field-grid--compact">
              <div className="filter-field leadership-shoot-workspace__checkbox">
                <span>Best Reference Candidate</span>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    aria-label="Best Reference Candidate"
                    checked={reviewForm.best_reference_candidate}
                    onChange={(event) =>
                      setReviewForm((current) => ({ ...current, best_reference_candidate: event.target.checked }))
                    }
                  />
                  <span>Keep this item in the curation queue.</span>
                </label>
              </div>
              <div className="filter-field leadership-shoot-workspace__checkbox">
                <span>Mark as Best Reference</span>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    aria-label="Mark as Best Reference"
                    checked={reviewForm.is_best_reference}
                    onChange={(event) =>
                      setReviewForm((current) => {
                        if (event.target.checked) {
                          return {
                            ...current,
                            approval_status: "approved",
                            visibility_scope: "photographer_prep",
                            is_best_reference: true,
                            best_reference_candidate: true
                          };
                        }
                        return {
                          ...current,
                          is_best_reference: false,
                          best_reference_category: ""
                        };
                      })
                    }
                  />
                  <span>Approved Best Reference items stay visible even if older than 2 years.</span>
                </label>
              </div>
              <label className="filter-field">
                <span>Best Reference Category</span>
                <select
                  value={reviewForm.best_reference_category}
                  onChange={(event) =>
                    setReviewForm((current) => ({
                      ...current,
                      best_reference_category: event.target.value as ResourceLibraryBestReferenceCategory | ""
                    }))
                  }
                  disabled={!reviewForm.is_best_reference}
                >
                  <option value="">Choose a category</option>
                  {BEST_REFERENCE_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          <label className="filter-field filter-field--wide">
            <span>Review Note</span>
            <textarea
              rows={2}
              value={reviewForm.review_note}
              onChange={(event) => setReviewForm((current) => ({ ...current, review_note: event.target.value }))}
              placeholder="Why this should stay reusable next year, stay leadership-only, or be rejected."
            />
          </label>
          <div className="access-actions">
            <button
              disabled={savingReview || (reviewForm.is_best_reference && !reviewForm.best_reference_category)}
              onClick={() => void saveReview()}
            >
              {savingReview ? "Saving Review..." : "Save Review"}
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                setReviewExpanded(false);
                setReviewForm(createReviewFormState(item));
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ResourcePreviewDialog({
  item,
  canDownload,
  limitedView,
  onClose
}: {
  item: ResourceLibraryItem | null;
  canDownload: boolean;
  limitedView: boolean;
  onClose: () => void;
}) {
  if (!item) {
    return null;
  }

  const canEmbedPdf =
    item.resource_type !== "image" &&
    Boolean(item.preview_url) &&
    (item.content_type === "application/pdf" || item.preview_url?.toLowerCase().endsWith(".pdf"));

  return (
    <div className="home-detail-overlay home-detail-overlay--workspace" role="dialog" aria-modal="true" aria-label={`${item.file_name} preview`}>
      <div className="home-detail-overlay__content home-detail-overlay__content--workspace resource-library__preview-dialog">
        <div className="home-detail-overlay__header">
          <div>
            <div className="eyebrow">Resource Preview</div>
            <h3>{item.file_name}</h3>
            <div className="home-detail-overlay__meta">
              <span className="meta-pill">{humanizeCategory(item.category)}</span>
              <span className="meta-pill">{humanizeApprovalStatus(item.approval_status)}</span>
              <span className="meta-pill">{humanizeVisibilityScope(item.visibility_scope)}</span>
              {item.is_best_reference && item.best_reference_category ? (
                <span className="meta-pill meta-pill--good">{humanizeBestReferenceCategory(item.best_reference_category)}</span>
              ) : null}
            </div>
          </div>
          <button className="secondary-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="home-detail-overlay__scroll">
          <div className="resource-library__preview-dialog-shell">
            <div className="resource-library__preview-stage">
              {item.resource_type === "image" && item.preview_url ? (
                <img src={item.preview_url} alt={item.file_name} />
              ) : item.resource_type === "video" && item.preview_url ? (
                <video src={item.preview_url} controls preload="metadata" />
              ) : canEmbedPdf && item.preview_url ? (
                <iframe src={item.preview_url} title={`${item.file_name} preview`} />
              ) : (
                <div className="empty-state empty-state--panel">
                  No inline preview is available for this file yet. Leadership can still open or download the original file when allowed.
                </div>
              )}
            </div>

            <div className="resource-library__preview-sidebar">
              <section className="request-card resource-library__preview-sidebar-card">
                <strong>Retrieval Controls</strong>
                <div className="resource-library__preview-actions">
                  {item.preview_url ? (
                    <a className="secondary-button" href={item.preview_url} target="_blank" rel="noreferrer">
                      Open Original
                    </a>
                  ) : null}
                  {canDownload && item.download_url ? (
                    <a className="secondary-button" href={item.download_url} target="_blank" rel="noreferrer">
                      Download
                    </a>
                  ) : null}
                </div>
                {limitedView ? (
                  <div className="muted">Download stays leadership-only on photographer prep surfaces. Viewing remains contextual in Mission Control.</div>
                ) : (
                  <div className="muted">Leadership can preview in-app first, then open or download the original file when needed.</div>
                )}
              </section>

              <section className="request-card resource-library__preview-sidebar-card">
                <strong>Context</strong>
                <div className="dashboard-stack dashboard-stack--tight">
                  <div className="dashboard-summary-row">
                    <span className="muted">Linked Context</span>
                    <strong>{buildResourceLinkedContextLabel(item)}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Uploader</span>
                    <strong>{item.uploader_name ?? "Unknown uploader"}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Uploaded</span>
                    <strong>{formatTimestamp(item.created_at)}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Captured</span>
                    <strong>{item.captured_at ? formatTimestamp(item.captured_at) : "Not captured"}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Upload Source</span>
                    <strong>{item.upload_source ? humanizeUploadSource(item.upload_source) : "Unknown"}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">File Type</span>
                    <strong>{item.content_type ?? humanizeLabel(item.resource_type)}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">File Size</span>
                    <strong>{formatFileSize(item.file_size_bytes)}</strong>
                  </div>
                </div>
              </section>

              {(item.note || item.review_note || item.reviewed_at) ? (
                <section className="request-card resource-library__preview-sidebar-card">
                  <strong>Review Context</strong>
                  <div className="dashboard-stack dashboard-stack--tight">
                    {item.note ? (
                      <div className="dashboard-summary-row">
                        <span className="muted">Uploader Note</span>
                        <strong>{item.note}</strong>
                      </div>
                    ) : null}
                    {item.review_note ? (
                      <div className="dashboard-summary-row">
                        <span className="muted">Review Note</span>
                        <strong>{item.review_note}</strong>
                      </div>
                    ) : null}
                    {item.reviewed_at ? (
                      <div className="dashboard-summary-row">
                        <span className="muted">Reviewed</span>
                        <strong>
                          {formatTimestamp(item.reviewed_at)}
                          {item.reviewed_by_name ? ` by ${item.reviewed_by_name}` : ""}
                        </strong>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LearningCard({ learning }: { learning: ResourceLibraryLearning }) {
  return (
    <article className="resource-library__learning-card request-card">
      <div className="resource-library__card-meta">
        <span className="meta-pill">Post-Shoot Evaluation Highlight</span>
        <span className="meta-pill">{learning.overall_rating}/5</span>
      </div>
      <strong>{learning.shoot_name}</strong>
      <div className="muted">
        {learning.shoot_date} | {learning.photographer_name}
      </div>
      <div className="dashboard-stack dashboard-stack--tight">
        {learning.recommendations ? (
          <div className="dashboard-summary-row">
            <span className="muted">Remember next time</span>
            <strong>{learning.recommendations}</strong>
          </div>
        ) : null}
        {learning.access_details ? (
          <div className="dashboard-summary-row">
            <span className="muted">Access</span>
            <strong>{learning.access_details}</strong>
          </div>
        ) : null}
        {learning.late_details ? (
          <div className="dashboard-summary-row">
            <span className="muted">Timing</span>
            <strong>{learning.late_details}</strong>
          </div>
        ) : null}
        {learning.notes ? (
          <div className="dashboard-summary-row">
            <span className="muted">Notes</span>
            <strong>{learning.notes}</strong>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function allResourceItems(library: ResourceLibraryView) {
  return [...library.media, ...library.documents, ...library.historical_references];
}

function buildBestReferenceCategoryCoverage(items: ResourceLibraryItem[]): BestReferenceCategoryCoverage[] {
  return BEST_REFERENCE_CATEGORY_OPTIONS.map((option) => {
    const curatedItems = sortResourceItems(
      items.filter((item) => item.is_best_reference && item.best_reference_category === option.value)
    ).slice(0, 3);
    return {
      category: option.value,
      label: option.label,
      count: curatedItems.length,
      remaining: Math.max(0, 3 - curatedItems.length),
      items: curatedItems
    };
  });
}

function createReviewFormState(item: ResourceLibraryItem): ResourceLibraryReviewFormState {
  return {
    approval_status: item.approval_status,
    visibility_scope: item.visibility_scope,
    category: item.category,
    best_reference_candidate: item.best_reference_candidate,
    is_best_reference: item.is_best_reference,
    best_reference_category: item.best_reference_category ?? "",
    review_note: item.review_note ?? ""
  };
}

function applyApprovalStatusToReviewForm(
  current: ResourceLibraryReviewFormState,
  approvalStatus: ResourceLibraryApprovalStatus
): ResourceLibraryReviewFormState {
  if (approvalStatus === "rejected_not_useful") {
    return {
      ...current,
      approval_status: approvalStatus,
      visibility_scope: "leadership_only",
      is_best_reference: false,
      best_reference_category: ""
    };
  }
  if (approvalStatus === "leadership_only") {
    return {
      ...current,
      approval_status: approvalStatus,
      visibility_scope: "leadership_only",
      is_best_reference: false,
      best_reference_category: ""
    };
  }
  return {
    ...current,
    approval_status: approvalStatus
  };
}

function updateResourceLibraryView(view: ResourceLibraryView, updatedItem: ResourceLibraryItem): ResourceLibraryView {
  const itemMap = new Map<string, ResourceLibraryItem>();
  for (const item of [...view.review_queue, ...view.prep_highlights, ...view.media, ...view.documents, ...view.historical_references]) {
    itemMap.set(item.id, item);
  }
  itemMap.set(updatedItem.id, updatedItem);

  const allItems = [...itemMap.values()];
  const documents = allItems.filter((item) => isDocumentResourceItem(item));
  const historicalReferences = allItems.filter((item) => isHistoricalReferenceItem(item));
  const documentIds = new Set(documents.map((item) => item.id));
  const historicalReferenceIds = new Set(historicalReferences.map((item) => item.id));
  const media = allItems.filter((item) => !documentIds.has(item.id) && !historicalReferenceIds.has(item.id));
  const prepHighlights = buildPrepHighlightsForClient(allItems);
  const reviewQueue = buildReviewQueueForClient(allItems);

  return {
    ...view,
    summary: {
      total_items: allItems.length,
      media_count: media.length,
      document_count: documents.length,
      best_reference_count: allItems.filter((item) => item.is_best_reference).length,
      pending_review_count: allItems.filter((item) => item.approval_status === "pending_review").length,
      leadership_only_count: allItems.filter((item) => item.approval_status === "leadership_only").length,
      rejected_count: allItems.filter((item) => item.approval_status === "rejected_not_useful").length,
      prep_highlight_count: prepHighlights.length
    },
    review_queue: reviewQueue,
    prep_highlights: prepHighlights,
    media,
    documents,
    historical_references: historicalReferences
  };
}

function buildReviewQueueForClient(items: ResourceLibraryItem[]) {
  return items
    .filter((item) => item.approval_status === "pending_review" || item.best_reference_candidate)
    .sort((left, right) => {
      const leftRank = left.approval_status === "pending_review" ? 0 : 1;
      const rightRank = right.approval_status === "pending_review" ? 0 : 1;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });
}

function buildPrepHighlightsForClient(items: ResourceLibraryItem[]) {
  return items
    .filter((item) => item.approval_status !== "rejected_not_useful")
    .sort((left, right) => {
      const leftScore = getPrepHighlightScore(left);
      const rightScore = getPrepHighlightScore(right);
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return new Date(right.captured_at ?? right.created_at).getTime() - new Date(left.captured_at ?? left.created_at).getTime();
    })
    .slice(0, 8);
}

function isDocumentResourceItem(item: ResourceLibraryItem) {
  return item.resource_type === "document" || item.resource_type === "qr_code";
}

function isHistoricalReferenceItem(item: ResourceLibraryItem) {
  return item.is_best_reference || ["location_reference", "prior_successful_example", "product_example"].includes(item.category);
}

function matchesResourceItemFilters(item: ResourceLibraryItem, filters: ResourceItemFilterState) {
  const normalizedSearch = normalizeSearch(filters.search);
  if (normalizedSearch) {
    const haystack = normalizeSearch(
      [
        item.file_name,
        item.note,
        item.organization_display_name,
        item.location_name,
        item.shoot_code,
        item.shoot_title,
        item.uploader_name,
        item.issue_type
      ]
        .filter(Boolean)
        .join(" ")
    );
    if (!haystack.includes(normalizedSearch)) {
      return false;
    }
  }
  if (filters.categoryFilter !== "all" && item.category !== filters.categoryFilter) {
    return false;
  }
  if (filters.scopeFilter !== "all" && item.linked_scope !== filters.scopeFilter) {
    return false;
  }
  if (filters.uploaderFilter !== "all" && item.uploader_name !== filters.uploaderFilter) {
    return false;
  }
  if (filters.issueFilter !== "all" && item.issue_type !== filters.issueFilter) {
    return false;
  }
  if (filters.organizationFilter !== "all" && item.organization_id !== filters.organizationFilter) {
    return false;
  }
  if (filters.locationFilter !== "all" && item.location_id !== filters.locationFilter) {
    return false;
  }
  if (filters.shootFilter !== "all" && item.shoot_id !== filters.shootFilter) {
    return false;
  }
  if (filters.shootDateFilter !== "all" && item.shoot_date !== filters.shootDateFilter) {
    return false;
  }
  return matchesWindow(item.captured_at ?? item.created_at, filters.windowFilter);
}

function matchesLearningFilters(learning: ResourceLibraryLearning, filters: ResourceLearningFilterState) {
  const normalizedSearch = normalizeSearch(filters.search);
  if (normalizedSearch) {
    const haystack = normalizeSearch(
      [
        learning.organization_display_name,
        learning.location_name,
        learning.shoot_name,
        learning.photographer_name,
        learning.recommendations,
        learning.notes,
        learning.access_details,
        learning.late_details
      ]
        .filter(Boolean)
        .join(" ")
    );
    if (!haystack.includes(normalizedSearch)) {
      return false;
    }
  }
  if (filters.uploaderFilter !== "all" && learning.photographer_name !== filters.uploaderFilter) {
    return false;
  }
  if (filters.organizationFilter !== "all" && learning.organization_id !== filters.organizationFilter) {
    return false;
  }
  if (filters.locationFilter !== "all" && learning.location_id !== filters.locationFilter) {
    return false;
  }
  if (filters.shootFilter !== "all" && learning.shoot_id !== filters.shootFilter) {
    return false;
  }
  if (filters.shootDateFilter !== "all" && learning.shoot_date !== filters.shootDateFilter) {
    return false;
  }
  return matchesWindow(learning.shoot_date, filters.windowFilter);
}

function buildRecurringIntelligenceView(
  library: ResourceLibraryView | null | undefined,
  items: ResourceLibraryItem[],
  learnings: ResourceLibraryLearning[]
): RecurringIntelligenceView {
  const curatedItems = items.filter((item) => item.approval_status !== "rejected_not_useful");
  const recurringContacts = library?.recurring_location_intelligence?.recurring_contacts ?? [];
  const setupPhotos = sortResourceItems(curatedItems.filter((item) => item.category === "setup_photo")).slice(0, 6);
  const priorSuccessfulExamples = sortResourceItems(curatedItems.filter((item) => item.category === "prior_successful_example")).slice(0, 6);
  const productDesignExamples = sortResourceItems(curatedItems.filter((item) => item.category === "product_example")).slice(0, 6);
  const locationReferences = sortResourceItems(curatedItems.filter((item) => item.category === "location_reference")).slice(0, 6);
  const qrJobDocs = sortResourceItems(
    curatedItems.filter(
      (item) =>
        item.category === "qr_code_job_document" || item.resource_type === "document" || item.resource_type === "qr_code"
    )
  ).slice(0, 6);
  const bestReference = sortResourceItems(curatedItems.filter((item) => item.is_best_reference)).slice(0, 6);
  const evaluationHighlights = sortLearnings(learnings).slice(0, 6);
  const whatToKnowNextTime = buildRecurringReminders(curatedItems, learnings);
  const mapsAccessReminders = buildMapsAndAccessReminders(learnings);
  const previousShoots = buildPreviousShootSummaries(learnings);

  return {
    whatToKnowNextTime,
    mapsAccessReminders,
    recurringContacts,
    previousShoots,
    bestReference,
    setupPhotos,
    priorSuccessfulExamples,
    productDesignExamples,
    locationReferences,
    qrJobDocs,
    evaluationHighlights
  };
}

function buildRecurringReminders(items: ResourceLibraryItem[], learnings: ResourceLibraryLearning[]) {
  const reminders: RecurringReminder[] = [];

  for (const item of items) {
    if (!["issue_concern", "equipment_setup_need"].includes(item.category)) {
      continue;
    }
    reminders.push({
      id: `resource:${item.id}`,
      label: item.category === "issue_concern" ? "Issue to remember" : "Equipment / setup need",
      detail: item.note ?? item.file_name,
      created_at: item.captured_at ?? item.created_at,
      shoot_name: item.shoot_title,
      shoot_date: item.shoot_date
    });
  }

  for (const learning of learnings) {
    const detail = learning.recommendations ?? learning.notes;
    if (!detail) {
      continue;
    }
    reminders.push({
      id: `learning:${learning.id}`,
      label: "Remember next time",
      detail,
      created_at: learning.shoot_date,
      shoot_name: learning.shoot_name,
      shoot_date: learning.shoot_date
    });
  }

  return dedupeRecurringReminders(reminders).slice(0, 8);
}

function buildMapsAndAccessReminders(learnings: ResourceLibraryLearning[]) {
  const reminders: RecurringReminder[] = [];

  for (const learning of learnings) {
    if (learning.access_details) {
      reminders.push({
        id: `access:${learning.id}`,
        label: "Access reminder",
        detail: learning.access_details,
        created_at: learning.shoot_date,
        shoot_name: learning.shoot_name,
        shoot_date: learning.shoot_date
      });
    }
    if (learning.late_details) {
      reminders.push({
        id: `timing:${learning.id}`,
        label: "Timing reminder",
        detail: learning.late_details,
        created_at: learning.shoot_date,
        shoot_name: learning.shoot_name,
        shoot_date: learning.shoot_date
      });
    }
  }

  return dedupeRecurringReminders(reminders).slice(0, 8);
}

function dedupeRecurringReminders(reminders: RecurringReminder[]) {
  const deduped = new Map<string, RecurringReminder>();
  for (const reminder of reminders) {
    const key = `${reminder.label}:${reminder.detail.toLowerCase()}`;
    if (!deduped.has(key)) {
      deduped.set(key, reminder);
    }
  }
  return [...deduped.values()].sort(
    (left, right) => new Date(right.created_at ?? 0).getTime() - new Date(left.created_at ?? 0).getTime()
  );
}

function buildPreviousShootSummaries(learnings: ResourceLibraryLearning[]) {
  const deduped = new Map<string, RecurringShootSummary>();

  for (const learning of sortLearnings(learnings)) {
    const key = learning.shoot_id ?? `${learning.shoot_name}:${learning.shoot_date}`;
    if (!deduped.has(key)) {
      deduped.set(key, {
        id: learning.id,
        shoot_id: learning.shoot_id ?? null,
        shoot_name: learning.shoot_name,
        shoot_date: learning.shoot_date,
        photographer_name: learning.photographer_name,
        overall_rating: learning.overall_rating
      });
    }
  }

  return [...deduped.values()].slice(0, 8);
}

function buildResourceFilterOptions(options: Array<ResourceFilterOption | null>) {
  const deduped = new Map<string, string>();
  for (const option of options) {
    if (!option || !option.value) {
      continue;
    }
    if (!deduped.has(option.value)) {
      deduped.set(option.value, option.label);
    }
  }
  return [...deduped.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function buildShootResourceCenterSections(items: ResourceLibraryItem[]) {
  const curatedItems = items.filter((item) => item.approval_status !== "rejected_not_useful");
  return [
    {
      key: "prior_successful_examples",
      title: "Prior Successful Examples",
      summary: "Strong prior coverage frames that help the crew understand the visual target for this Shoot.",
      items: sortResourceItems(curatedItems.filter((item) => item.category === "prior_successful_example")).slice(0, 4)
    },
    {
      key: "setup_photos",
      title: "Setup Photos",
      summary: "Setup and staging reference pulled forward so the team can recreate what worked.",
      items: sortResourceItems(curatedItems.filter((item) => item.category === "setup_photo")).slice(0, 4)
    },
    {
      key: "product_design_examples",
      title: "Product / Design Examples",
      summary: "Product examples that clarify output expectations before the crew leaves for the job.",
      items: sortResourceItems(curatedItems.filter((item) => item.category === "product_example")).slice(0, 4)
    },
    {
      key: "location_references",
      title: "Location References",
      summary: "Entrances, unload paths, and physical wayfinding context tied to this Location.",
      items: sortResourceItems(curatedItems.filter((item) => item.category === "location_reference")).slice(0, 4)
    },
    {
      key: "documents_qr",
      title: "Documents & QR Files",
      summary: "QR packets, PDFs, and operational job documents kept inside the same shared Resource Library.",
      items: sortResourceItems(
        curatedItems.filter(
          (item) =>
            item.category === "qr_code_job_document" || item.resource_type === "document" || item.resource_type === "qr_code"
        )
      ).slice(0, 4)
    }
  ];
}

function sortResourceItems(items: ResourceLibraryItem[]) {
  return [...items].sort((left, right) => {
    const leftTimestamp = new Date(left.captured_at ?? left.created_at).getTime();
    const rightTimestamp = new Date(right.captured_at ?? right.created_at).getTime();
    return rightTimestamp - leftTimestamp;
  });
}

function sortLearnings(learnings: ResourceLibraryLearning[]) {
  return [...learnings].sort((left, right) => new Date(right.shoot_date).getTime() - new Date(left.shoot_date).getTime());
}

function getPrepHighlightScore(item: ResourceLibraryItem) {
  if (item.is_best_reference) {
    return 100;
  }
  if (item.category === "setup_photo") {
    return 80;
  }
  if (item.category === "prior_successful_example") {
    return 70;
  }
  if (item.category === "location_reference") {
    return 60;
  }
  if (item.category === "product_example") {
    return 55;
  }
  if (item.category === "qr_code_job_document") {
    return 50;
  }
  if (item.category === "equipment_setup_need") {
    return 40;
  }
  if (item.category === "issue_concern") {
    return 35;
  }
  return 20;
}

function matchesWindow(value: string | null, windowFilter: ResourceWindowFilter) {
  if (windowFilter === "all") {
    return true;
  }
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  if (Number.isNaN(timestamp)) {
    return false;
  }
  const now = Date.now();
  const months12 = 365 * 24 * 60 * 60 * 1000;
  const months24 = 2 * months12;
  if (windowFilter === "last_12_months") {
    return now - timestamp <= months12;
  }
  if (windowFilter === "last_24_months") {
    return now - timestamp <= months24;
  }
  return now - timestamp > months24;
}

function buildRecurringIntelligenceSummary(scopeLabel: Props["scopeLabel"]) {
  if (scopeLabel === "Shoot") {
    return "What this crew should know before heading back out: setup history, prior wins, evaluation highlights, access reminders, recurring contacts, and job docs tied to this prep context.";
  }
  if (scopeLabel === "Location") {
    return "Historical prep memory for this Location, structured so the next team can find what matters without digging through old files.";
  }
  return "Recurring prep context across this Organization, combining historical media, learnings, contacts, and agreement-adjacent job memory.";
}

function buildTabSummary(tab: ResourceLibraryTab, count: number, scopeLabel: string) {
  if (tab === "media") {
    return `${count} media item${count === 1 ? "" : "s"} linked to this ${scopeLabel}.`;
  }
  if (tab === "documents") {
    return `${count} document${count === 1 ? "" : "s"} available inside the same Resource Library experience.`;
  }
  return `${count} historical reference${count === 1 ? "" : "s"} linked to this ${scopeLabel}.`;
}

function humanizeLinkedScope(value: ResourceLibraryLinkedScope) {
  if (value === "shoot") {
    return "Shoot";
  }
  if (value === "location") {
    return "Location";
  }
  return "Organization";
}

function humanizeApprovalStatus(value: ResourceLibraryItem["approval_status"]) {
  if (value === "pending_review") {
    return "Pending Review";
  }
  if (value === "rejected_not_useful") {
    return "Rejected / Not Useful";
  }
  if (value === "leadership_only") {
    return "Leadership Only";
  }
  return "Approved for Future Reference";
}

function humanizeBestReferenceCategory(value: ResourceLibraryBestReferenceCategory) {
  return BEST_REFERENCE_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? humanizeLabel(value);
}

function humanizeVisibilityScope(value: ResourceLibraryVisibilityScope) {
  if (value === "photographer_prep") {
    return "Photographer Prep";
  }
  return "Leadership Only";
}

function humanizeCategory(value: ResourceLibraryCategory) {
  return RESOURCE_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? humanizeLabel(value);
}

function humanizeTabLabel(tab: ResourceLibraryTab) {
  if (tab === "historical_references") {
    return "Historical References";
  }
  if (tab === "post_shoot_learnings") {
    return "Post-Shoot Learnings";
  }
  return humanizeLabel(tab);
}

function buildResourceSummaryLine(item: ResourceLibraryItem) {
  const parts = [humanizeCategory(item.category)];
  if (item.issue_type) {
    parts.push(humanizeLabel(item.issue_type));
  }
  if (item.content_type) {
    parts.push(item.content_type);
  }
  return parts.join(" | ");
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Date unavailable";
  }
  return new Date(value).toLocaleDateString();
}

function formatFileSize(value: number | null) {
  if (!value || value <= 0) {
    return "Unavailable";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)} MB`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)} KB`;
  }
  return `${value} B`;
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function buildShootLabel(code: string | null, title: string | null) {
  if (code && title) {
    return `${code} | ${title}`;
  }
  return code ?? title ?? "Unnamed Shoot";
}

function humanizeLabel(value?: string | null) {
  if (!value) {
    return "Unknown";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeUploadSource(value: ResourceLibraryItem["upload_source"]) {
  if (!value) {
    return "Unknown";
  }
  if (value === "mobile_camera") {
    return "iPhone / Android Camera";
  }
  if (value === "mobile_library") {
    return "Camera Roll / Gallery";
  }
  if (value === "mobile_document") {
    return "Document Picker";
  }
  if (value === "web_upload") {
    return "Web Upload";
  }
  return "System Migration";
}

function buildResourceLinkedContextLabel(item: ResourceLibraryItem) {
  return [item.organization_display_name, item.location_name, buildShootLabel(item.shoot_code, item.shoot_title)]
    .filter((value) => value && value !== "Unnamed Shoot")
    .join(" | ");
}
