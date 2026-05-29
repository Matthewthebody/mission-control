import { useEffect, useMemo, useState } from "react";
import { HistoricalContextPanel } from "../components/HistoricalContextPanel";
import { LocationSubmissionActions } from "../components/LocationSubmissionActions";
import { OperationalDetailSection } from "../components/OperationalDetailSection";
import { OperationalPreviewCard } from "../components/OperationalPreviewCard";
import { ResourceLibraryPanel } from "../components/ResourceLibraryPanel";
import {
  fetchShootLocations,
  getLocationPhotographerPerformance,
  reviewShootLocationEvaluation,
  reviewShootLocationPhoto,
  getShootLocationDetail,
  getTopRatedShootLocations,
  readCachedLocationCatalog
} from "../services/locationApi";
import type {
  LocationPhotographerPerformanceRow,
  LocationTopRatedRow,
  SessionUser,
  ShootLocationDetail,
  ShootLocationEvaluation,
  ShootLocationSummary
} from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type LocationView = "guide" | "top-rated" | "photographers";
type LocationSort = "alpha" | "top_rated" | "nearby";
type LocationDetailPanel = "overview" | "setup" | "history" | "resource_library" | "updates" | "diagnostics";

type RouteState = {
  view: LocationView;
  locationId: string | null;
  shootId: string | null;
  outlookEventId: string | null;
  outlookCalendarId: string | null;
  shootCode: string | null;
  shootName: string | null;
  shootDate: string | null;
  eventSubject: string | null;
  eventLocation: string | null;
};

type GeoPoint = {
  latitude: number;
  longitude: number;
};

export function ShootLocations({ token, currentUser }: Props) {
  const [route, setRoute] = useState<RouteState>(() => parseLocationsHash());
  const [catalog, setCatalog] = useState<ShootLocationSummary[]>([]);
  const [detail, setDetail] = useState<ShootLocationDetail | null>(null);
  const [topRated, setTopRated] = useState<LocationTopRatedRow[]>([]);
  const [photographerRows, setPhotographerRows] = useState<LocationPhotographerPerformanceRow[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<LocationSort>("alpha");
  const [detailPanel, setDetailPanel] = useState<LocationDetailPanel>("overview");
  const [photographerFilter, setPhotographerFilter] = useState("all");
  const [geoPoint, setGeoPoint] = useState<GeoPoint | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingSupplemental, setLoadingSupplemental] = useState(false);
  const [error, setError] = useState("");
  const [offlineBanner, setOfflineBanner] = useState("");
  const [cacheLabel, setCacheLabel] = useState("");
  const [updateNotice, setUpdateNotice] = useState("");
  const [reviewBusyKey, setReviewBusyKey] = useState("");

  useEffect(() => {
    const sync = () => setRoute(parseLocationsHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    const cached = readCachedLocationCatalog();
    if (cached?.payload.locations.length) {
      setCatalog(cached.payload.locations);
      setCacheLabel(
        cached.isExpired
          ? "Showing a saved location guide while Mission Control refreshes in the background."
          : "Showing the saved location guide instantly while live data refreshes."
      );
      setLoadingCatalog(false);
    }

    let cancelled = false;
    setLoadingCatalog(!cached?.payload.locations.length);
    void fetchShootLocations(token)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setCatalog(payload.locations);
        setOfflineBanner("");
        setCacheLabel(
          payload.cache.stale
            ? "Location guide is using the last successful catalog sync."
            : "Location guide is live from the latest catalog sync."
        );
      })
      .catch((fetchError) => {
        if (cancelled) {
          return;
        }
        if (cached?.payload.locations.length) {
          setOfflineBanner("Live location refresh failed, so Mission Control is showing the saved location guide for field use.");
        } else {
          setError(fetchError instanceof Error ? fetchError.message : "We couldn't load the Shoot Locations guide.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingCatalog(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (route.view === "top-rated" && !topRated.length) {
      setLoadingSupplemental(true);
      void getTopRatedShootLocations(token)
        .then((rows) => setTopRated(rows))
        .catch((supplementalError) =>
          setError(supplementalError instanceof Error ? supplementalError.message : "We couldn't load top-rated locations.")
        )
        .finally(() => setLoadingSupplemental(false));
    }

    if (route.view === "photographers" && !photographerRows.length) {
      setLoadingSupplemental(true);
      void getLocationPhotographerPerformance(token)
        .then((rows) => setPhotographerRows(rows))
        .catch((supplementalError) =>
          setError(supplementalError instanceof Error ? supplementalError.message : "We couldn't load photographer history.")
        )
        .finally(() => setLoadingSupplemental(false));
    }
  }, [photographerRows.length, route.view, token, topRated.length]);

  const filteredLocations = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    let rows = [...catalog];

    if (normalizedSearch) {
      rows = rows.filter((location) =>
        `${location.name} ${location.address ?? ""} ${location.location_details ?? ""} ${location.commentary ?? ""}`
          .toLowerCase()
          .includes(normalizedSearch)
      );
    }

    if (category !== "all") {
      rows = rows.filter((location) => location.category === category);
    }

    const withDistance = rows.map((location) => ({
      ...location,
      distance_miles:
        sort === "nearby" &&
        geoPoint &&
        typeof location.latitude === "number" &&
        typeof location.longitude === "number"
          ? haversineMiles(geoPoint.latitude, geoPoint.longitude, location.latitude, location.longitude)
          : location.distance_miles ?? null
    }));

    if (sort === "top_rated") {
      withDistance.sort((left, right) => {
        const ratingDelta = Number(right.stats.avg_rating ?? 0) - Number(left.stats.avg_rating ?? 0);
        if (ratingDelta !== 0) {
          return ratingDelta;
        }
        return right.stats.evaluation_count - left.stats.evaluation_count;
      });
    } else if (sort === "nearby") {
      withDistance.sort((left, right) => {
        if (left.distance_miles === null && right.distance_miles === null) {
          return left.name.localeCompare(right.name);
        }
        if (left.distance_miles === null) {
          return 1;
        }
        if (right.distance_miles === null) {
          return -1;
        }
        return left.distance_miles - right.distance_miles;
      });
    } else {
      withDistance.sort((left, right) => left.name.localeCompare(right.name));
    }

    return withDistance;
  }, [catalog, category, geoPoint, search, sort]);

  const activeLocationId = useMemo(() => {
    if (route.view !== "guide") {
      return null;
    }
    if (route.locationId && filteredLocations.some((location) => location.id === route.locationId)) {
      return route.locationId;
    }
    return filteredLocations[0]?.id ?? null;
  }, [filteredLocations, route.locationId, route.view]);

  const activeLocationSummary = useMemo(
    () => filteredLocations.find((location) => location.id === activeLocationId) ?? null,
    [activeLocationId, filteredLocations]
  );

  useEffect(() => {
    if (route.view !== "guide") {
      setDetail(null);
      return;
    }

    if (!activeLocationId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setLoadingDetail(true);
    void getShootLocationDetail(token, activeLocationId)
      .then((payload) => {
        if (!cancelled) {
          setDetail(payload);
          setError("");
        }
      })
      .catch((detailError) => {
        if (!cancelled) {
          setError(detailError instanceof Error ? detailError.message : "We couldn't load that location guide entry.");
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
  }, [activeLocationId, route.view, token]);

  const filteredEvaluations = useMemo(() => {
    if (!detail) {
      return [];
    }
    return detail.evaluations.filter((evaluation) =>
      photographerFilter === "all" ? true : evaluation.photographer_name === photographerFilter
    );
  }, [detail, photographerFilter]);

  const evaluationPhotographers = useMemo(() => {
    if (!detail) {
      return [];
    }
    return [...new Set(detail.evaluations.map((evaluation) => evaluation.photographer_name))].sort((left, right) =>
      left.localeCompare(right)
    );
  }, [detail]);

  const locationGuideSummary = useMemo(() => {
    const readyCount = catalog.filter((location) => getLocationListStatus(location).label === "Ready").length;
    const thinCount = catalog.filter((location) => getLocationListStatus(location).label === "Thin").length;
    const referencePhotoCount = catalog.reduce((sum, location) => sum + location.photo_count, 0);
    const attentionCount = catalog.filter((location) => getLocationNeedsAttention(location)).length;

    return {
      totalCount: catalog.length,
      readyCount,
      thinCount,
      attentionCount,
      referencePhotoCount
    };
  }, [catalog]);

  const canSeeLegacyDiagnostics =
    currentUser.permissions.includes("audit.read") ||
    ["leadership", "director_admin", "super_admin"].includes(currentUser.authorityTier);
  const hasLegacyDiagnostics = Boolean(detail?.integration) && canSeeLegacyDiagnostics;
  const canReviewLocationKnowledge =
    currentUser.permissions.includes("shoot.update") &&
    !["photographer", "senior_photographer"].includes(currentUser.authorityTier);

  const selectedGuideContext =
    route.shootCode || route.shootName || route.eventSubject
      ? [route.shootCode, route.shootName ?? route.eventSubject].filter(Boolean).join(" | ")
      : null;

  useEffect(() => {
    setDetailPanel("overview");
  }, [activeLocationId]);

  useEffect(() => {
    if (detailPanel === "diagnostics" && !hasLegacyDiagnostics) {
      setDetailPanel("overview");
    }
  }, [detailPanel, hasLegacyDiagnostics]);

  async function refreshLocationDetail(locationId: string) {
    const payload = await getShootLocationDetail(token, locationId);
    setDetail(payload);
    return payload;
  }

  async function handleEvaluationReview(evaluationId: string, evalStatus: "reviewed" | "closed") {
    if (!detail) {
      return;
    }
    setReviewBusyKey(`${evalStatus}-${evaluationId}`);
    setError("");
    setUpdateNotice("");
    try {
      const payload = await reviewShootLocationEvaluation(token, evaluationId, {
        eval_status: evalStatus,
        note: null
      });
      setDetail(payload);
      setUpdateNotice(evalStatus === "closed" ? "Post-shoot eval closed." : "Post-shoot eval reviewed.");
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "We couldn't review that post-shoot eval.");
    } finally {
      setReviewBusyKey("");
    }
  }

  async function handlePhotoReview(photoId: string, memoryState: "reviewed" | "added_to_memory") {
    if (!detail) {
      return;
    }
    setReviewBusyKey(`${memoryState}-${photoId}`);
    setError("");
    setUpdateNotice("");
    try {
      const payload = await reviewShootLocationPhoto(token, photoId, {
        memory_state: memoryState,
        note: null
      });
      setDetail(payload);
      setUpdateNotice(memoryState === "added_to_memory" ? "Setup photo added to memory." : "Setup photo reviewed.");
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "We couldn't review that setup photo.");
    } finally {
      setReviewBusyKey("");
    }
  }

  function pushRoute(next: Partial<RouteState>) {
    const merged = { ...route, ...next };
    const params = new URLSearchParams();
    if (merged.view !== "guide") {
      params.set("view", merged.view);
    }
    if (merged.locationId) {
      params.set("location", merged.locationId);
    }
    if (merged.shootId) {
      params.set("shoot", merged.shootId);
    }
    if (merged.outlookEventId) {
      params.set("event", merged.outlookEventId);
    }
    if (merged.outlookCalendarId) {
      params.set("calendar", merged.outlookCalendarId);
    }
    if (merged.shootCode) {
      params.set("shootCode", merged.shootCode);
    }
    if (merged.shootName) {
      params.set("shootName", merged.shootName);
    }
    if (merged.shootDate) {
      params.set("shootDate", merged.shootDate);
    }
    if (merged.eventSubject) {
      params.set("subject", merged.eventSubject);
    }
    if (merged.eventLocation) {
      params.set("eventLocation", merged.eventLocation);
    }
    window.location.hash = params.toString() ? `#directory/locations?${params.toString()}` : "#directory/locations";
  }

  async function requestNearbySort() {
    if (!navigator.geolocation) {
      setError("This browser does not expose location access for nearby sorting.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoPoint({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
        setSort("nearby");
      },
      () => {
        setError("Mission Control could not read your current location for nearby sorting.");
      },
      {
        enableHighAccuracy: true,
        timeout: 7000,
        maximumAge: 5 * 60 * 1000
      }
    );
  }

  return (
    <div className="workspace-shell">
      <section className="page-intro page-intro--workspace panel">
        <div className="page-intro__body">
          <div className="eyebrow">Shoot Locations</div>
          <h2>Kemmetmueller Location Guide</h2>
          <p>
            Search the location guide fast, jump straight into the right venue, and keep setup intelligence easy to scan without burying field context under legacy migration noise.
          </p>
        </div>
        <div className="page-intro-actions page-intro-actions--compact">
          <div className="metric-pill metric-pill--identity">Viewer {currentUser.fullName}</div>
          <div className="meta-pill">Search-first guide</div>
        </div>
      </section>

      <section className="panel workspace-toolbar">
        <div className="workspace-toolbar__group">
          <div className="report-tab-row">
            <button className={route.view === "guide" ? "is-active" : ""} onClick={() => pushRoute({ view: "guide" })}>
              Location Guide
            </button>
            <button
              className={route.view === "top-rated" ? "is-active" : ""}
              onClick={() => pushRoute({ view: "top-rated" })}
            >
              Top Rated
            </button>
            <button
              className={route.view === "photographers" ? "is-active" : ""}
              onClick={() => pushRoute({ view: "photographers" })}
            >
              Photographers
            </button>
          </div>
        </div>
        <div className="workspace-toolbar__actions">
          <button
            className="secondary-button"
            onClick={() =>
              void fetchShootLocations(token)
                .then((payload) => setCatalog(payload.locations))
                .catch((refreshError) =>
                  setError(refreshError instanceof Error ? refreshError.message : "We couldn't refresh the location guide.")
                )
            }
          >
            Refresh
          </button>
        </div>
      </section>

      <section className="metrics-grid workspace-summary-strip">
        <article className="stat-card panel">
          <div className="eyebrow">Guide Entries</div>
          <strong>{locationGuideSummary.totalCount}</strong>
          <span className="muted">Every school, venue, and setup record currently in the searchable guide.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Field-Ready</div>
          <strong>{locationGuideSummary.readyCount}</strong>
          <span className="muted">Locations with meaningful setup notes and visual reference already on file.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Needs Attention</div>
          <strong>{locationGuideSummary.attentionCount}</strong>
          <span className="muted">Locations with thin setup coverage or repeat access friction that still need leadership cleanup.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Reference Photos</div>
          <strong>{locationGuideSummary.referencePhotoCount}</strong>
          <span className="muted">{locationGuideSummary.thinCount} locations are still running light on setup detail.</span>
        </article>
      </section>

      {cacheLabel ? <div className="live-banner">{cacheLabel}</div> : null}
      {updateNotice ? <div className="success-banner">{updateNotice}</div> : null}
      {offlineBanner ? <div className="error-banner">{offlineBanner}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {loadingCatalog && !catalog.length ? (
        <section className="panel loading-panel">
          <div className="section-title">Loading location guide</div>
          <p className="section-subtitle">
            Pulling the cached location catalog, setup context, and post-shoot history so field staff can get in and out
            quickly.
          </p>
        </section>
      ) : null}

      {route.view === "guide" ? (
        <section className="locations-layout workspace-main">
          <div className="panel locations-sidebar workspace-rail">
            <div className="dashboard-panel__header">
              <div>
                <div className="section-title">Search Results</div>
                <p className="section-subtitle">
                  Find the venue fast, narrow the guide by type, and keep the detail panel anchored to the result set you are actually viewing.
                </p>
              </div>
              <span className="metric-pill">{filteredLocations.length}</span>
            </div>
            <div className="field-grid">
              <label className="filter-field filter-field--wide">
                <span>Search</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="School, gym, stadium, address, or setup note"
                />
              </label>
              <label className="filter-field">
                <span>Type</span>
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="all">All Types</option>
                  <option value="school">School</option>
                  <option value="sports">Sports</option>
                  <option value="studio">Studio</option>
                  <option value="venue">Venue</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="filter-field">
                <span>Sort</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as LocationSort)}>
                  <option value="alpha">A-Z</option>
                  <option value="top_rated">Top Rated</option>
                  <option value="nearby">Nearby</option>
                </select>
              </label>
            </div>
            <div className="location-search-summary">
              <strong>{filteredLocations.length} result{filteredLocations.length === 1 ? "" : "s"}</strong>
              <span className="muted">
                {search.trim()
                  ? `Searching "${search.trim()}" across names, addresses, and saved setup context.`
                  : activeLocationSummary
                    ? `Showing the full searchable guide. ${activeLocationSummary.name} is currently in focus.`
                    : "Showing the full searchable guide."}
              </span>
            </div>
            {sort === "nearby" && !geoPoint ? (
              <div className="request-card">
                <strong>Nearby sort uses your current device location.</strong>
                <div className="muted">Mission Control only needs location when you're actively using the guide in the field.</div>
                <button className="secondary-button" onClick={requestNearbySort}>
                  Use My Current Location
                </button>
              </div>
            ) : null}
            <div className="ops-preview-list">
              {filteredLocations.map((location) => {
                const status = getLocationListStatus(location);
                return (
                  <OperationalPreviewCard
                    key={location.id}
                    eyebrow={humanizeLabel(location.category)}
                    title={location.name}
                    summary={getLocationListSummary(location)}
                    statusLabel={status.label}
                    statusTone={status.tone}
                    meta={[
                      { label: `Avg ${location.stats.avg_rating ?? "N/A"}` },
                      { label: `Photos ${location.photo_count}` },
                      { label: `Evals ${location.stats.evaluation_count}` },
                      ...(typeof location.distance_miles === "number" ? [{ label: `${location.distance_miles.toFixed(1)} mi` }] : [])
                    ]}
                    flags={[
                      ...(location.stats.on_time_percent < 80 || location.stats.easy_access_percent < 80
                        ? [{ label: "Access watch", tone: "warning" as const }]
                        : []),
                      ...(!location.location_details ? [{ label: "Missing setup note", tone: "warning" as const }] : []),
                      ...(location.latest_recommendation ? [{ label: "Recent reminder", tone: "info" as const }] : [])
                    ]}
                    nextAction={activeLocationId === location.id ? "Viewing guide detail" : "Open location guide"}
                    selected={activeLocationId === location.id}
                    onClick={() => pushRoute({ locationId: location.id })}
                  />
                );
              })}
              {!filteredLocations.length ? <div className="empty-state">No location guide entries match the current filters.</div> : null}
            </div>
          </div>

          <div className="panel locations-detail">
            {loadingDetail ? (
              <div className="empty-state empty-state--panel">Loading location detail...</div>
            ) : detail ? (
              <>
                <div className="locations-detail__header">
                  <div>
                    <div className="eyebrow">Location Guide</div>
                    <h3>{detail.name}</h3>
                    <p className="section-subtitle">{detail.address || "Address not captured in the source guide yet."}</p>
                  </div>
                  <div className="location-intelligence__stats">
                    <span className="metric-pill">Avg Rating {detail.stats.avg_rating ?? "N/A"}</span>
                    <span className="metric-pill">On Time {detail.stats.on_time_percent}%</span>
                    <span className="metric-pill">Easy Access {detail.stats.easy_access_percent}%</span>
                    <span className="metric-pill">Eval Count {detail.stats.evaluation_count}</span>
                    {selectedGuideContext ? <span className="metric-pill">Context {selectedGuideContext}</span> : null}
                  </div>
                </div>

                <div className="report-tab-row location-detail-tabs">
                  <button className={detailPanel === "overview" ? "is-active" : ""} onClick={() => setDetailPanel("overview")}>
                    Overview
                  </button>
                  <button className={detailPanel === "setup" ? "is-active" : ""} onClick={() => setDetailPanel("setup")}>
                    Setup
                  </button>
                  <button className={detailPanel === "history" ? "is-active" : ""} onClick={() => setDetailPanel("history")}>
                    History
                  </button>
                  <button
                    className={detailPanel === "resource_library" ? "is-active" : ""}
                    onClick={() => setDetailPanel("resource_library")}
                  >
                    Resource Library
                  </button>
                  <button className={detailPanel === "updates" ? "is-active" : ""} onClick={() => setDetailPanel("updates")}>
                    Updates
                  </button>
                  {hasLegacyDiagnostics ? (
                    <button className={detailPanel === "diagnostics" ? "is-active" : ""} onClick={() => setDetailPanel("diagnostics")}>
                      Diagnostics
                    </button>
                  ) : null}
                </div>

                {detailPanel === "overview" ? (
                  <div className="dashboard-stack">
                    <section className="location-preview-grid">
                      {(() => {
                        const readiness = getLocationSetupReadiness(detail);
                        return (
                          <OperationalPreviewCard
                            eyebrow="Setup Readiness"
                            title={readiness.title}
                            summary={readiness.summary}
                            statusLabel={readiness.label}
                            statusTone={readiness.tone}
                          />
                        );
                      })()}
                      {(() => {
                        const latestStatus = getLatestEvaluationStatus(detail);
                        return (
                          <OperationalPreviewCard
                            eyebrow="Recent Field Signal"
                            title={getLatestEvaluationTitle(detail)}
                            summary={getLatestEvaluationSummary(detail)}
                            statusLabel={latestStatus.label}
                            statusTone={latestStatus.tone}
                          />
                        );
                      })()}
                      {(() => {
                        const confidence = getLocationConfidence(detail);
                        return (
                          <OperationalPreviewCard
                            eyebrow="Access Reliability"
                            title={`${detail.stats.on_time_percent}% on time`}
                            summary={`Easy access ${detail.stats.easy_access_percent}% | Avg rating ${detail.stats.avg_rating ?? "N/A"}`}
                            statusLabel={confidence.label}
                            statusTone={confidence.tone}
                          />
                        );
                      })()}
                      <OperationalPreviewCard
                        eyebrow="Reference Coverage"
                        title={`${detail.photo_gallery.length} photos | ${detail.areas.length} areas`}
                        summary={detail.latest_recommendation || "No recent field recommendation has been saved yet."}
                        statusLabel={detail.photo_gallery.length || detail.areas.length ? "Documented" : "Thin"}
                        statusTone={detail.photo_gallery.length || detail.areas.length ? "success" : "warning"}
                      />
                    </section>

                    <OperationalDetailSection
                      title="Historical Context"
                      summary="The strongest reusable prior-location intelligence is surfaced first, with deeper history available on demand."
                      defaultOpen
                    >
                      <HistoricalContextPanel context={detail.historical_context ?? null} defaultExpanded />
                    </OperationalDetailSection>

                    <OperationalDetailSection
                      title="Location Memory"
                      summary={
                        detail.location_memory.top_watch_out
                          ? detail.location_memory.top_watch_out
                          : detail.location_memory.last_confirmed_at
                            ? `Last confirmed ${new Date(detail.location_memory.last_confirmed_at).toLocaleDateString()}`
                            : "Reusable operational guidance still needs review."
                      }
                      defaultOpen
                    >
                      <div className="detail-two-column">
                        <div className="request-card">
                          <strong>Where To Go</strong>
                          <div className="muted">{detail.location_memory.where_to_go || "No arrival instruction is saved yet."}</div>
                        </div>
                        <div className="request-card">
                          <strong>Where To Park</strong>
                          <div className="muted">{detail.location_memory.where_to_park || "No parking/load-in instruction is saved yet."}</div>
                        </div>
                        <div className="request-card">
                          <strong>Where To Set Up</strong>
                          <div className="muted">{detail.location_memory.where_to_set_up || "No setup guidance is saved yet."}</div>
                        </div>
                        <div className="request-card">
                          <strong>Top Watch-Out</strong>
                          <div className="muted">{detail.location_memory.top_watch_out || "No reusable watch-out has been promoted yet."}</div>
                        </div>
                      </div>
                      {detail.location_memory.notes.length ? (
                        <div className="timeline-list">
                          {detail.location_memory.notes.slice(0, 4).map((note) => (
                            <div key={note.id} className="timeline-item">
                              <div className="timeline-dot" />
                              <div>
                                <div className="timeline-title">
                                  <span className="timeline-type">{note.pinned ? "Pinned Memory" : "Location Memory"}</span>
                                  <span className="muted">{humanizeLabel(note.publication_state)}</span>
                                </div>
                                <div className="muted">{note.body}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </OperationalDetailSection>

                    <OperationalDetailSection
                      title="Access, Notes, And Contacts"
                      summary={
                        detail.location_details || detail.commentary || detail.custodian_contact
                          ? "Operational setup notes and contact context are on file."
                          : "This location still needs stronger operational notes."
                      }
                      defaultOpen
                    >
                      <div className="detail-two-column">
                        <div className="request-card">
                          <strong>Setup & Access</strong>
                          <div className="muted">{detail.location_details || "No primary setup note has been saved yet."}</div>
                        </div>
                        <div className="request-card">
                          <strong>Contacts & Travel</strong>
                          <div className="muted">
                            {detail.custodian_contact ? `Custodian: ${detail.custodian_contact}` : "No custodian contact is listed."}
                          </div>
                          <div className="muted">{detail.address || "Address not captured in the source guide yet."}</div>
                          {detail.navigation_url ? (
                            <a href={detail.navigation_url} target="_blank" rel="noreferrer">
                              Open in Maps
                            </a>
                          ) : null}
                        </div>
                        <div className="request-card">
                          <strong>Operational Reminder</strong>
                          <div className="muted">{detail.latest_recommendation || "No current best-practice reminder is saved yet."}</div>
                        </div>
                        <div className="request-card">
                          <strong>Commentary</strong>
                          <div className="muted">{detail.commentary || "No extra commentary is attached yet."}</div>
                        </div>
                      </div>
                    </OperationalDetailSection>
                  </div>
                ) : null}

                {detailPanel === "setup" ? (
                  <div className="dashboard-stack">
                    {(() => {
                      const readiness = getLocationSetupReadiness(detail);
                      return (
                        <div className="home-detail-callout home-shoot-workspace__callout">
                          <strong>{readiness.title}</strong>
                          <div className="muted">{readiness.summary}</div>
                        </div>
                      );
                    })()}

                    <OperationalDetailSection
                      title="Setup Photo Gallery"
                      summary={`${detail.photo_gallery.length} reference photo${detail.photo_gallery.length === 1 ? "" : "s"} available for field setup.`}
                      defaultOpen
                    >
                      <div className="setup-photo-grid">
                        {detail.photo_gallery.map((photo) => (
                          <figure key={photo.id} className="setup-photo-card">
                            <img src={photo.image_url} alt={photo.caption} />
                            <figcaption>
                              <strong>{photo.caption}</strong>
                              <div>{photo.uploader_name ?? "Location Guide"}</div>
                              <div className="muted">
                                {[photo.photo_category ? humanizeLabel(photo.photo_category) : null, photo.memory_state ? humanizeLabel(photo.memory_state) : null]
                                  .filter(Boolean)
                                  .join(" | ") || "Reference photo"}
                              </div>
                              {canReviewLocationKnowledge && photo.source !== "catalog" && photo.memory_state !== "added_to_memory" ? (
                                <div className="employee-link-row">
                                  {photo.memory_state !== "reviewed" ? (
                                    <button
                                      className="secondary-button"
                                      disabled={reviewBusyKey === `reviewed-${photo.id}`}
                                      onClick={() => void handlePhotoReview(photo.id, "reviewed")}
                                    >
                                      {reviewBusyKey === `reviewed-${photo.id}` ? "Saving..." : "Mark Reviewed"}
                                    </button>
                                  ) : null}
                                  <button
                                    className="secondary-button"
                                    disabled={reviewBusyKey === `added_to_memory-${photo.id}`}
                                    onClick={() => void handlePhotoReview(photo.id, "added_to_memory")}
                                  >
                                    {reviewBusyKey === `added_to_memory-${photo.id}` ? "Saving..." : "Add To Memory"}
                                  </button>
                                </div>
                              ) : null}
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                      {!detail.photo_gallery.length ? <div className="empty-state">No setup photo references have been saved yet.</div> : null}
                    </OperationalDetailSection>

                    <OperationalDetailSection
                      title="Sub-Areas"
                      summary={`${detail.areas.length} sub-area card${detail.areas.length === 1 ? "" : "s"} linked to this location.`}
                    >
                      <div className="detail-two-column">
                        {detail.areas.map((area) => (
                          <article key={area.id} className="request-card">
                            <strong>{area.name}</strong>
                            <div className="muted">{area.location_details || "No sub-area setup note yet."}</div>
                            {area.commentary ? <div className="muted">{area.commentary}</div> : null}
                            {area.photo_urls.length ? <div className="muted">{area.photo_urls.length} setup photo reference(s)</div> : null}
                          </article>
                        ))}
                      </div>
                      {!detail.areas.length ? <div className="empty-state">No sub-location cards are saved for this venue yet.</div> : null}
                    </OperationalDetailSection>
                  </div>
                ) : null}

                {detailPanel === "history" ? (
                  <div className="dashboard-stack">
                    <OperationalDetailSection
                      title="Historical Context"
                      summary="Recent comparable shoots, repeat issue signals, and open carry-forward items stay visible before the raw eval list."
                      defaultOpen
                    >
                      <HistoricalContextPanel context={detail.historical_context ?? null} defaultExpanded />
                    </OperationalDetailSection>

                    <OperationalDetailSection
                      title="Post-Shoot Evaluations"
                      summary={`${filteredEvaluations.length} evaluation${filteredEvaluations.length === 1 ? "" : "s"} in view for this location.`}
                      defaultOpen
                    >
                      <div className="field-grid">
                        <label className="filter-field">
                          <span>Photographer</span>
                          <select value={photographerFilter} onChange={(event) => setPhotographerFilter(event.target.value)}>
                            <option value="all">All photographers</option>
                            {evaluationPhotographers.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="timeline-list">
                        {filteredEvaluations.map((evaluation) => (
                          <div key={evaluation.id} className="timeline-item">
                            <div className="timeline-dot" />
                            <div>
                              <div className="timeline-title">
                                <span className="timeline-type">{evaluation.shoot_name}</span>
                                <span className="muted">
                                  {evaluation.shoot_date} | {evaluation.photographer_name} | {evaluation.overall_rating}/5
                                </span>
                              </div>
                              <div className="muted">
                                On Time {evaluation.on_time} | Easy Access {evaluation.easy_access} | Photos Uploaded {evaluation.photos_uploaded}
                              </div>
                              <div className="muted">
                                {[evaluation.eval_status ? humanizeLabel(evaluation.eval_status) : null, evaluation.overall_outcome ? humanizeLabel(evaluation.overall_outcome) : null]
                                  .filter(Boolean)
                                  .join(" | ") || "Legacy evaluation"}
                              </div>
                              <div className="muted">
                                {evaluation.next_time_recommendation ||
                                  evaluation.short_summary_note ||
                                  evaluation.recommendations ||
                                  evaluation.notes ||
                                  evaluation.access_details ||
                                  "No extra notes were recorded."}
                              </div>
                              {canReviewLocationKnowledge && evaluation.source !== "monday" && evaluation.eval_status !== "closed" ? (
                                <div className="employee-link-row">
                                  {evaluation.eval_status !== "reviewed" ? (
                                    <button
                                      className="secondary-button"
                                      disabled={reviewBusyKey === `reviewed-${evaluation.id}`}
                                      onClick={() => void handleEvaluationReview(evaluation.id, "reviewed")}
                                    >
                                      {reviewBusyKey === `reviewed-${evaluation.id}` ? "Saving..." : "Mark Reviewed"}
                                    </button>
                                  ) : null}
                                  <button
                                    className="secondary-button"
                                    disabled={reviewBusyKey === `closed-${evaluation.id}`}
                                    onClick={() => void handleEvaluationReview(evaluation.id, "closed")}
                                  >
                                    {reviewBusyKey === `closed-${evaluation.id}` ? "Saving..." : "Close Eval"}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ))}
                        {!filteredEvaluations.length ? <div className="empty-state">No evaluations match the current photographer filter.</div> : null}
                      </div>
                    </OperationalDetailSection>
                  </div>
                ) : null}

                {detailPanel === "resource_library" ? (
                  <div className="dashboard-stack">
                    <OperationalDetailSection
                      title="Resource Library"
                      summary="Setup references, documents, historical examples, and post-shoot learnings stay attached to this Location."
                      defaultOpen
                    >
                      <ResourceLibraryPanel library={detail.resource_library} scopeLabel="Location" token={token} />
                    </OperationalDetailSection>
                  </div>
                ) : null}

                {detailPanel === "updates" ? (
                  <div className="dashboard-stack">
                    <div className="request-card">
                      <strong>Field Updates</strong>
                      <div className="muted">
                        Add a new evaluation, upload fresh setup photos, or clear the missing-photo alert from one clean operational surface.
                      </div>
                    </div>
                    <LocationSubmissionActions
                      token={token}
                      currentUser={currentUser}
                      location={detail}
                      context={{
                        shootId: route.shootId,
                        outlookEventId: route.outlookEventId,
                        shootName: route.shootName ?? route.eventSubject ?? detail.name,
                        shootDate: route.shootDate ?? new Date().toISOString().slice(0, 10),
                        photographerName: currentUser.fullName
                      }}
                      onRefresh={async () => {
                        await refreshLocationDetail(detail.id);
                      }}
                    />
                  </div>
                ) : null}

                {detailPanel === "diagnostics" && hasLegacyDiagnostics ? (
                  <div className="dashboard-stack">
                    <OperationalDetailSection
                      title="Legacy Integration Diagnostics"
                      summary="Use this only when validating coexistence state, debug ownership, or Monday-linked history."
                      defaultOpen
                    >
                      <section className={`feedback-strip feedback-strip--${mapMigrationTone(detail.integration!.migration_state)}`}>
                        <div className="feedback-strip__content">
                          <strong>{humanizeMigrationState(detail.integration!.migration_state)}</strong>
                          <div>{detail.integration!.source_label}</div>
                          <div className="muted">
                            {detail.integration!.last_synced_at
                              ? `Last Monday refresh ${new Date(detail.integration!.last_synced_at).toLocaleString()}`
                              : "No Monday-linked refresh is recorded yet."}
                          </div>
                          {detail.integration!.externally_controlled_fields.length ? (
                            <div className="muted">
                              Monday-controlled fields: {detail.integration!.externally_controlled_fields.join(", ")}
                            </div>
                          ) : null}
                        </div>
                        <div className="feedback-strip__actions">
                          {detail.integration!.monday_item_url ? (
                            <a className="secondary-button" href={detail.integration!.monday_item_url} target="_blank" rel="noreferrer">
                              View In Monday
                            </a>
                          ) : null}
                        </div>
                      </section>

                      <div className="dashboard-stack">
                        {detail.integration!.warnings.map((warning) => (
                          <div key={warning} className="live-banner">
                            {warning}
                          </div>
                        ))}
                        {!detail.integration!.warnings.length ? (
                          <div className="empty-state empty-state--panel">No active legacy integration warnings are attached to this record.</div>
                        ) : null}
                      </div>
                    </OperationalDetailSection>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty-state empty-state--panel">
                {filteredLocations.length
                  ? "Select a location from the result list to see setup notes, setup photos, sub-areas, and post-shoot history."
                  : "No locations match the current filters. Clear the search or change the filters to keep working."}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {route.view === "top-rated" ? (
        <section className="panel dashboard-panel">
          <div className="section-title">Top Rated Locations</div>
          <p className="section-subtitle">
            Leadership can spot the venues that consistently run smooth and the ones whose access patterns are helping or
            hurting the day.
          </p>
          <div className="shoot-metric-grid">
            {topRated.map((row) => (
              <article key={row.location_id} className="shoot-metric-card">
                <div className="eyebrow">{row.evaluation_count} evals</div>
                <strong>{row.location_name}</strong>
                <div className="muted">{row.address || "Address not captured"}</div>
                <div className="dashboard-summary-list">
                  <div className="dashboard-summary-row">
                    <span className="muted">Avg rating</span>
                    <strong>{row.avg_rating ?? "N/A"}</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">On time</span>
                    <strong>{row.on_time_percent}%</strong>
                  </div>
                  <div className="dashboard-summary-row">
                    <span className="muted">Easy access</span>
                    <strong>{row.easy_access_percent}%</strong>
                  </div>
                </div>
                <button className="secondary-button" onClick={() => pushRoute({ view: "guide", locationId: row.location_id })}>
                  Open Location Guide
                </button>
              </article>
            ))}
          </div>
          {!loadingSupplemental && !topRated.length ? <div className="empty-state">No scored location history is available yet.</div> : null}
        </section>
      ) : null}

      {route.view === "photographers" ? (
        <section className="panel dashboard-panel">
          <div className="section-title">Photographer Location Performance</div>
          <p className="section-subtitle">
            A field-facing read on who tends to run clean, on-time, and easy-access picture days based on post-shoot
            history.
          </p>
          <div className="report-table-shell">
            <table className="shoots-table report-table">
              <thead>
                <tr>
                  <th>Photographer</th>
                  <th>Avg Rating</th>
                  <th>On Time</th>
                  <th>Easy Access</th>
                  <th>Latest Location</th>
                  <th>Last Shoot</th>
                </tr>
              </thead>
              <tbody>
                {photographerRows.map((row) => (
                  <tr key={`${row.photographer_name}-${row.latest_shoot_date ?? "none"}`}>
                    <td>
                      <strong>{row.photographer_name}</strong>
                      <div className="muted">{row.evaluation_count} evaluations</div>
                    </td>
                    <td>{row.avg_rating ?? "N/A"}</td>
                    <td>{row.on_time_percent}%</td>
                    <td>{row.easy_access_percent}%</td>
                    <td>{row.latest_location_name ?? "N/A"}</td>
                    <td>{row.latest_shoot_date ?? "N/A"}</td>
                  </tr>
                ))}
                {!loadingSupplemental && !photographerRows.length ? (
                  <tr>
                    <td colSpan={6} className="empty-state">
                      No photographer history is available yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function parseLocationsHash(): RouteState {
  const [, query = ""] = window.location.hash.split("?");
  const params = new URLSearchParams(query);
  const view = params.get("view");
  return {
    view: view === "top-rated" || view === "photographers" ? view : "guide",
    locationId: params.get("location"),
    shootId: params.get("shoot"),
    outlookEventId: params.get("event"),
    outlookCalendarId: params.get("calendar"),
    shootCode: params.get("shootCode"),
    shootName: params.get("shootName"),
    shootDate: params.get("shootDate"),
    eventSubject: params.get("subject"),
    eventLocation: params.get("eventLocation")
  };
}

function humanizeLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function haversineMiles(leftLat: number, leftLng: number, rightLat: number, rightLng: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const latitudeDelta = toRadians(rightLat - leftLat);
  const longitudeDelta = toRadians(rightLng - leftLng);
  const leftRadians = toRadians(leftLat);
  const rightRadians = toRadians(rightLat);

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftRadians) * Math.cos(rightRadians) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function summarizeText(value?: string | null, fallback = "Setup context is still thin for this location.") {
  const text = value?.trim();
  if (!text) {
    return fallback;
  }
  if (text.length <= 108) {
    return text;
  }
  return `${text.slice(0, 105).trimEnd()}...`;
}

function getLocationListSummary(location: ShootLocationSummary) {
  return summarizeText(
    location.location_details || location.latest_recommendation || location.address,
    "Address or setup context has not been captured yet."
  );
}

function getLocationListStatus(location: ShootLocationSummary) {
  const hasSetupCoverage = Boolean(location.location_details) && (location.photo_count > 0 || location.area_count > 0);
  if (hasSetupCoverage) {
    return { label: "Ready", tone: "success" as const };
  }
  if (location.location_details || location.photo_count > 0 || location.area_count > 0) {
    return { label: "Partial", tone: "warning" as const };
  }
  return { label: "Thin", tone: "warning" as const };
}

function getLocationNeedsAttention(location: ShootLocationSummary) {
  return Boolean(
    getLocationListStatus(location).label !== "Ready" ||
      location.stats.on_time_percent < 80 ||
      location.stats.easy_access_percent < 80
  );
}

function getLocationSetupReadiness(detail: ShootLocationDetail) {
  const hasSetupNote = Boolean(detail.location_details);
  const hasPhotos = detail.photo_gallery.length > 0;
  const hasAreas = detail.areas.length > 0;

  if (hasSetupNote && hasPhotos) {
    return {
      title: "Field-ready reference",
      summary: `Primary setup note saved with ${detail.photo_gallery.length} setup photo${detail.photo_gallery.length === 1 ? "" : "s"} and ${detail.areas.length} area card${detail.areas.length === 1 ? "" : "s"}.`,
      label: "Ready",
      tone: "success" as const
    };
  }

  if (hasSetupNote || hasPhotos || hasAreas) {
    return {
      title: "Partial setup context",
      summary: "Mission Control has some setup guidance, but the guide still has thin spots that could slow first arrival.",
      label: "Partial",
      tone: "warning" as const
    };
  }

  return {
    title: "Thin setup context",
    summary: "No saved setup note, no setup photos, and no sub-area detail are currently on file.",
    label: "Needs detail",
    tone: "critical" as const
  };
}

function getLatestEvaluation(detail: ShootLocationDetail): ShootLocationEvaluation | null {
  return detail.evaluations[0] ?? null;
}

function getLatestEvaluationTitle(detail: ShootLocationDetail) {
  const latest = getLatestEvaluation(detail);
  if (!latest) {
    return "No recent evaluation";
  }
  return `${latest.overall_rating}/5 from ${latest.photographer_name}`;
}

function getLatestEvaluationSummary(detail: ShootLocationDetail) {
  const latest = getLatestEvaluation(detail);
  if (!latest) {
    return "No recent post-shoot evaluation is available for this location yet.";
  }
  return summarizeText(
    latest.recommendations || latest.notes || latest.access_details,
    `On time ${latest.on_time} | Easy access ${latest.easy_access} | Photos uploaded ${latest.photos_uploaded}`
  );
}

function getLatestEvaluationStatus(detail: ShootLocationDetail) {
  const latest = getLatestEvaluation(detail);
  if (!latest) {
    return { label: "No history", tone: "warning" as const };
  }
  if (latest.overall_rating >= 4 && latest.on_time === "Yes" && latest.easy_access === "Yes") {
    return { label: "Strong", tone: "success" as const };
  }
  if (latest.overall_rating <= 2 || latest.on_time === "No") {
    return { label: "Attention", tone: "critical" as const };
  }
  return { label: "Mixed", tone: "warning" as const };
}

function getLocationConfidence(detail: ShootLocationDetail) {
  if (detail.stats.on_time_percent >= 85 && detail.stats.easy_access_percent >= 85) {
    return { label: "Reliable", tone: "success" as const };
  }
  if (detail.stats.on_time_percent < 70 || detail.stats.easy_access_percent < 70) {
    return { label: "Needs review", tone: "critical" as const };
  }
  return { label: "Watch", tone: "warning" as const };
}

function humanizeMigrationState(value: NonNullable<ShootLocationSummary["integration"]>["migration_state"]) {
  if (value === "partially_migrated") {
    return "Partially Migrated";
  }
  if (value === "mission_control_owned") {
    return "Mission Control Owned";
  }
  if (value === "not_yet_migrated") {
    return "Not Yet Migrated";
  }
  return "Coexisting";
}

function mapMigrationTone(value: NonNullable<ShootLocationSummary["integration"]>["migration_state"]) {
  if (value === "mission_control_owned") {
    return "success";
  }
  if (value === "not_yet_migrated") {
    return "warning";
  }
  return "info";
}
