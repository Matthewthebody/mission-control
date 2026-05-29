import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { ApiClientError } from "../../api";
import { buildShellRouteHash, type ShellRouteId } from "../../navigation";
import { canAccessTeamsCommunicationSurface } from "../../permissions";
import { getTeamsEmbeddedCommunicationHub } from "../../services/teamsEmbeddedCommunicationsApi";
import type { TeamsEmbeddedCommunicationEntry, TeamsEmbeddedCommunicationHub } from "../../teamsEmbeddedCommunicationTypes";
import type { SessionUser } from "../../types";
import { OverlayPanel } from "../OverlayPanel";

type Props = {
  token: string;
  currentUser: SessionUser;
  mobile: boolean;
  fullRouteId: ShellRouteId;
};

const PINNED_STORAGE_KEY = "pmc-communications-pins";
const LAST_SEEN_STORAGE_KEY = "pmc-communications-last-seen";

export function CommunicationsLauncher({ token, currentUser, mobile, fullRouteId }: Props) {
  const canAccess = canAccessTeamsCommunicationSurface(currentUser);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [hub, setHub] = useState<TeamsEmbeddedCommunicationHub | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pinnedKeys, setPinnedKeys] = useState<string[]>(() => readPinnedKeys());
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(() => readLastSeenAt());

  useEffect(() => {
    if (!open || !canAccess) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void getTeamsEmbeddedCommunicationHub(token)
      .then((payload) => {
        if (!cancelled) {
          setHub(payload);
        }
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof ApiClientError ? err.message : "We couldn't load Communications right now.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canAccess, open, token]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const next = new Date().toISOString();
    setLastSeenAt(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_SEEN_STORAGE_KEY, next);
    }
  }, [open]);

  const entries = hub?.entries ?? [];
  const urgentItems = buildUrgentItems(entries);
  const pinnedEntries = entries.filter((entry) => pinnedKeys.includes(getEntryKey(entry)));
  const filteredEntries = sortLauncherEntries(entries, pinnedKeys, urgentItems).filter((entry) => matchesLauncherSearch(entry, search));
  const launcherCount = countNewActivity(entries, urgentItems, lastSeenAt);

  return (
    <>
      <button
        type="button"
        className={`communications-launcher__trigger${mobile ? " communications-launcher__trigger--mobile" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span>Teams</span>
        <strong>{launcherCount}</strong>
      </button>
      <OverlayPanel
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel="Communications launcher"
        overlayClassName={`communications-launcher__overlay${mobile ? " communications-launcher__overlay--mobile" : ""}`}
        contentClassName={`communications-launcher__panel${mobile ? " communications-launcher__panel--mobile" : ""}`}
      >
        <section className="communications-launcher">
          <div className="communications-launcher__header">
            <div>
              <div className="eyebrow">Teams Entry Points</div>
              <h2>Quick access</h2>
              <p>Human-facing Teams shortcuts for record-linked follow-through, urgent issues, linked meetings, and fast jumps back into Mission Control.</p>
            </div>
            <div className="teams-communications__entry-actions">
              <button type="button" className="secondary-button" onClick={() => setSearch("")}>
                + Find More
              </button>
              <button type="button" className="secondary-button" onClick={() => openFullCommunications(fullRouteId)}>
                Open Actions Page
              </button>
            </div>
          </div>

          <div className="communications-launcher__metrics">
            <div className="teams-home__metric">
              <span>Action-needed</span>
              <strong>{launcherCount}</strong>
            </div>
            <div className="teams-home__metric">
              <span>Pinned</span>
              <strong>{pinnedEntries.length}</strong>
            </div>
            <div className="teams-home__metric">
              <span>Meetings</span>
              <strong>{hub?.summary.active_meetings ?? 0}</strong>
            </div>
          </div>

          <label className="filter-field filter-field--wide">
            <span>Search records or destinations</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search records, destinations, or organizations" />
          </label>

          {!loading && hub?.availability.state !== "ready" ? (
            <div className={`teams-home__state${hub?.availability.state === "revoked" ? " teams-home__state--error" : ""}`}>
              <strong>{hub?.availability.title}</strong>
              <div>{hub?.availability.detail}</div>
              {hub?.availability.fix_hint ? <div>{hub.availability.fix_hint}</div> : null}
            </div>
          ) : null}

          {loading ? <div className="teams-home__state">Loading communications launcher...</div> : null}
          {error ? <div className="teams-home__state teams-home__state--error">{error}</div> : null}

          {!loading && !error ? (
            <>
              <div className="communications-launcher__section">
                <div className="section-title">Pinned</div>
                {!pinnedEntries.length ? <div className="empty-state">Pin important records here for fast access.</div> : null}
                <div className="communications-launcher__list">
                  {pinnedEntries.map((entry) => (
                    <LauncherEntry
                      key={getEntryKey(entry)}
                      entry={entry}
                      pinned
                      onTogglePin={() => togglePinnedKey(getEntryKey(entry), setPinnedKeys)}
                    />
                  ))}
                </div>
              </div>

              <div className="communications-launcher__section">
                <div className="section-title">Urgent</div>
                {!urgentItems.length ? <div className="empty-state">No urgent communication issues are active right now.</div> : null}
                <div className="communications-launcher__list">
                  {urgentItems.slice(0, 4).map((item) => (
                    <button key={item.id} type="button" className="communications-launcher__urgent" onClick={() => openHash(item.routeHash)}>
                      <strong>{item.title}</strong>
                      <span>{item.summary}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="communications-launcher__section">
                <div className="section-title">Results</div>
                {!filteredEntries.length ? <div className="empty-state">No linked communication records matched that search.</div> : null}
                <div className="communications-launcher__list">
                  {filteredEntries.slice(0, 3).map((entry) => (
                    <LauncherEntry
                      key={getEntryKey(entry)}
                      entry={entry}
                      pinned={pinnedKeys.includes(getEntryKey(entry))}
                      onTogglePin={() => togglePinnedKey(getEntryKey(entry), setPinnedKeys)}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </section>
      </OverlayPanel>
    </>
  );
}

function LauncherEntry({
  entry,
  pinned,
  onTogglePin
}: {
  entry: TeamsEmbeddedCommunicationEntry;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  const reference = entry.communication.references.find((item) => item.is_primary) ?? entry.communication.references[0] ?? null;
  return (
    <article className="communications-launcher__entry">
      <div className="communications-launcher__entry-copy">
        <strong>{entry.object_label}</strong>
        <span>{[entry.record_kind_label, reference?.label, entry.organization_label].filter(Boolean).join(" | ")}</span>
      </div>
      <div className="communications-launcher__entry-actions">
        <button type="button" className="secondary-button" onClick={() => openHash(entry.route_hash)}>
          Open
        </button>
        <button type="button" className="secondary-button" onClick={onTogglePin}>
          {pinned ? "Unpin" : "Pin"}
        </button>
      </div>
    </article>
  );
}

function buildUrgentItems(entries: TeamsEmbeddedCommunicationEntry[]) {
  return entries.flatMap((entry) => {
    const items: Array<{ id: string; title: string; summary: string; routeHash: string }> = [];
    const latestDelivery = entry.communication.recent_deliveries[0] ?? null;
    if (latestDelivery?.status === "failed") {
      items.push({
        id: `${getEntryKey(entry)}:delivery`,
        title: `${entry.object_label} send failed`,
        summary: latestDelivery.last_error || "A recent Teams send failed.",
        routeHash: entry.route_hash
      });
    }
    if (entry.meeting.meeting?.sync_error) {
      items.push({
        id: `${getEntryKey(entry)}:meeting`,
        title: `${entry.object_label} meeting needs repair`,
        summary: entry.meeting.meeting.sync_error,
        routeHash: entry.route_hash
      });
    }
    if (!entry.communication.references.length) {
      items.push({
        id: `${getEntryKey(entry)}:destination`,
        title: `${entry.object_label} needs a Teams destination`,
        summary: "Link a reviewed Teams destination before using record-linked updates.",
        routeHash: entry.route_hash
      });
    }
    return items;
  });
}

function sortLauncherEntries(
  entries: TeamsEmbeddedCommunicationEntry[],
  pinnedKeys: string[],
  urgentItems: Array<{ id: string; title: string; summary: string; routeHash: string }>
) {
  const urgentKeySet = new Set(urgentItems.map((item) => item.routeHash.replace(/^#/, "")));
  return [...entries].sort((left, right) => {
    const leftKey = getEntryKey(left);
    const rightKey = getEntryKey(right);
    const leftPinned = pinnedKeys.includes(leftKey);
    const rightPinned = pinnedKeys.includes(rightKey);
    if (leftPinned !== rightPinned) {
      return leftPinned ? -1 : 1;
    }
    const leftUrgent = urgentKeySet.has(left.route_hash.replace(/^#/, ""));
    const rightUrgent = urgentKeySet.has(right.route_hash.replace(/^#/, ""));
    if (leftUrgent !== rightUrgent) {
      return leftUrgent ? -1 : 1;
    }
    const leftTime = left.latest_activity_at ? new Date(left.latest_activity_at).getTime() : 0;
    const rightTime = right.latest_activity_at ? new Date(right.latest_activity_at).getTime() : 0;
    return rightTime - leftTime;
  });
}

function countNewActivity(
  entries: TeamsEmbeddedCommunicationEntry[],
  urgentItems: Array<{ id: string }>,
  lastSeenAt: string | null
) {
  const seenAt = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
  const newEntries = entries.filter((entry) => {
    if (!entry.latest_activity_at) {
      return false;
    }
    const activityAt = new Date(entry.latest_activity_at).getTime();
    return Number.isFinite(activityAt) && activityAt > seenAt;
  }).length;
  return newEntries + urgentItems.length;
}

function matchesLauncherSearch(entry: TeamsEmbeddedCommunicationEntry, search: string) {
  const normalized = search.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const haystack = [
    entry.object_label,
    entry.record_kind_label,
    entry.organization_label,
    entry.location_label,
    ...entry.communication.references.map((reference) => reference.label)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalized);
}

function getEntryKey(entry: TeamsEmbeddedCommunicationEntry) {
  return `${entry.object_type}:${entry.object_id}`;
}

function readPinnedKeys() {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function readLastSeenAt() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(LAST_SEEN_STORAGE_KEY);
}

function togglePinnedKey(key: string, setPinnedKeys: Dispatch<SetStateAction<string[]>>) {
  let nextKeys: string[] = [];
  setPinnedKeys((current) => {
    nextKeys = current.includes(key) ? current.filter((item) => item !== key) : [key, ...current].slice(0, 8);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(nextKeys));
    }
    return nextKeys;
  });
  return nextKeys;
}

function openFullCommunications(routeId: ShellRouteId) {
  openHash(buildShellRouteHash(routeId));
}

function openHash(hash: string) {
  window.location.hash = hash.startsWith("#") ? hash : `#${hash}`;
}
