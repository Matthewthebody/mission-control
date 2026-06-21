import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../api";
import type {
  DirectoryContactDetailResponse,
  DirectoryLocationSummary,
  OrganizationDetail,
  SessionUser
} from "../types";
import {
  getDirectoryContactDetail,
  getOrganizationDetail,
  listDirectoryLocations
} from "../services/organizationApi";
import { canManageCanonicalDirectoryRecords } from "../permissions";
import { OrganizationHierarchyCard } from "../components/directory/OrganizationHierarchyCard";
import { ServiceTermsPanel } from "../components/directory/ServiceTermsPanel";
import { LogoHistoryPanel } from "../components/directory/LogoHistoryPanel";
import { CanonicalContactsPanel } from "../components/directory/CanonicalContactsPanel";
import { DirectoryAvatar } from "../components/directory/DirectoryAvatar";
import { formatDateLabel, labelForActiveStatus } from "../components/directory/directoryOptions";

// Phase 4.2 — stable, permission-safe full-page canonical record routes
// (#directory/organizations/<id>, #directory/contacts/<id>, #directory/locations/<id>).
// It reuses the existing canonical reads + detail panels and adds the route-grade states
// the quick preview never had: loading / not-found / denied / archived-read-only, plus a
// context-preserving Back to the matching Directory list mode.

type RecordType = "organization" | "contact" | "location";

type Props = {
  token: string;
  currentUser: SessionUser;
  recordType: RecordType;
};

type LoadState = "loading" | "ready" | "not_found" | "denied" | "error";

const LIST_HASH: Record<RecordType, string> = {
  organization: "#accounts",
  contact: "#directory/contacts",
  location: "#directory/locations"
};

// The id is the last path segment of the hash (#directory/organizations/<id>).
function parseRecordId(): string {
  const raw = window.location.hash.replace(/^#/, "").split("?")[0];
  const segments = raw.split("/").filter(Boolean);
  return segments.length ? decodeURIComponent(segments[segments.length - 1]) : "";
}

function backToDirectory(recordType: RecordType) {
  // Prefer the return context captured when entering the detail; else the list mode.
  const stored = sessionStorage.getItem("directory:return-hash");
  window.location.hash = stored && stored.startsWith("#") ? stored : LIST_HASH[recordType];
}

export function DirectoryRecordDetailPage({ token, currentUser, recordType }: Props) {
  const [recordId, setRecordId] = useState(parseRecordId);
  const [state, setState] = useState<LoadState>("loading");
  const [organization, setOrganization] = useState<OrganizationDetail | null>(null);
  const [contact, setContact] = useState<DirectoryContactDetailResponse | null>(null);
  const [location, setLocation] = useState<DirectoryLocationSummary | null>(null);

  const canManage = canManageCanonicalDirectoryRecords(currentUser);

  useEffect(() => {
    const onHash = () => setRecordId(parseRecordId());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const load = useCallback(async () => {
    if (!recordId) {
      setState("not_found");
      return;
    }
    setState("loading");
    setOrganization(null);
    setContact(null);
    setLocation(null);
    try {
      if (recordType === "organization") {
        setOrganization(await getOrganizationDetail(token, recordId));
      } else if (recordType === "contact") {
        setContact(await getDirectoryContactDetail(token, recordId));
      } else {
        const list = await listDirectoryLocations(token, {});
        const match = list.locations.find((entry) => entry.id === recordId) ?? null;
        if (!match) {
          setState("not_found");
          return;
        }
        setLocation(match);
      }
      setState("ready");
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.status === 404) return setState("not_found");
        if (error.status === 401 || error.status === 403) return setState("denied");
      }
      setState("error");
    }
  }, [recordId, recordType, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const header = (
    <div className="record-detail__topbar">
      <button type="button" className="secondary-button" onClick={() => backToDirectory(recordType)}>
        ← Back to Directory
      </button>
    </div>
  );

  if (state === "loading") {
    return (
      <section className="record-detail" aria-busy="true">
        {header}
        <div className="request-card empty-state empty-state--panel">Loading this record…</div>
      </section>
    );
  }
  if (state === "denied") {
    return (
      <section className="record-detail">
        {header}
        <div className="request-card empty-state empty-state--panel" role="alert">
          You don't have access to this directory record.
        </div>
      </section>
    );
  }
  if (state === "not_found") {
    return (
      <section className="record-detail">
        {header}
        <div className="request-card empty-state empty-state--panel" role="alert">
          This record no longer exists or could not be found.
        </div>
      </section>
    );
  }
  if (state === "error") {
    return (
      <section className="record-detail">
        {header}
        <div className="request-card empty-state empty-state--panel" role="alert">
          We couldn't load this record right now.{" "}
          <button type="button" className="link-button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </section>
    );
  }

  if (recordType === "organization" && organization) {
    return <OrganizationRecordDetail detail={organization} token={token} canManage={canManage} header={header} />;
  }
  if (recordType === "contact" && contact) {
    return <ContactRecordDetail detail={contact} header={header} />;
  }
  if (recordType === "location" && location) {
    return <LocationRecordDetail location={location} header={header} />;
  }
  return (
    <section className="record-detail">
      {header}
      <div className="request-card empty-state empty-state--panel">Nothing to show.</div>
    </section>
  );
}

function ArchivedBanner({ archived }: { archived: boolean }) {
  if (!archived) return null;
  return (
    <div className="record-detail__archived" role="status">
      <span className="meta-pill meta-pill--warning">Archived — read-only</span>
      <span className="muted">This record is archived. Reactivate it to make changes.</span>
    </div>
  );
}

function OrganizationRecordDetail({
  detail,
  token,
  canManage,
  header
}: {
  detail: OrganizationDetail;
  token: string;
  canManage: boolean;
  header: React.ReactNode;
}) {
  const org = detail.organization;
  const archived = org.active_status === "inactive";
  const isSchool = org.account_type.startsWith("schools");
  const isDistrict = org.client_entity_kind === "parent_organization";
  const contacts = detail.contacts ?? [];
  const locations = detail.locations ?? [];

  return (
    <section className="record-detail" aria-label={`${org.display_name} detail`}>
      {header}
      <div className="request-card record-detail__hero">
        <DirectoryAvatar name={org.display_name} imageUrl={org.logo_url} kind="organization" size="lg" />
        <div>
          <p className="eyebrow">{isDistrict ? "District" : isSchool ? "School" : "Organization"}</p>
          <h1>{org.display_name}</h1>
          <div className="directory-chip-row">
            <span className="meta-pill">{org.account_type.replace(/_/g, " ")}</span>
            <span className="meta-pill">{labelForActiveStatus(org.active_status)}</span>
            {org.website ? <span className="meta-pill">{org.website}</span> : null}
            {org.main_phone ? <span className="meta-pill">{org.main_phone}</span> : null}
          </div>
        </div>
      </div>
      <ArchivedBanner archived={archived} />

      <OrganizationHierarchyCard detail={detail} isSchoolAccount={isSchool} onSelectOrganization={(id) => (window.location.hash = `#directory/organizations/${id}`)} />

      {(isSchool || isDistrict) ? (
        <ServiceTermsPanel token={token} organizationId={org.id} organizationName={org.display_name} canManage={canManage && !archived} />
      ) : null}

      <LogoHistoryPanel token={token} organizationId={org.id} organizationName={org.display_name} currentLogoUrl={org.logo_url} canManage={canManage && !archived} />

      <CanonicalContactsPanel token={token} organizationId={org.id} canManage={canManage && !archived} />

      <section className="request-card" aria-label="Contextual contacts">
        <div className="directory-card__header">
          <div>
            <strong>Contacts ({contacts.length})</strong>
            <div className="muted">People linked to this organization, with their contextual role.</div>
          </div>
        </div>
        {contacts.length ? (
          <ul className="record-detail__list">
            {contacts.slice(0, 25).map((c) => (
              <li key={c.id}>
                <button type="button" className="directory-link-button" onClick={() => (window.location.hash = `#directory/contacts/${c.id}`)}>
                  <span>{c.full_name}{c.title ? ` — ${c.title}` : ""}</span>
                  <span className="muted">{c.email || c.phone || "No contact info"}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state empty-state--panel">No contacts linked yet.</div>
        )}
      </section>

      <section className="request-card" aria-label="Approved locations">
        <div className="directory-card__header">
          <div>
            <strong>Locations ({locations.length})</strong>
            <div className="muted">Approved canonical locations for this organization.</div>
          </div>
        </div>
        {locations.length ? (
          <ul className="record-detail__list">
            {locations.slice(0, 25).map((loc) => (
              <li key={loc.id}>
                <button type="button" className="directory-link-button" onClick={() => (window.location.hash = `#directory/locations/${loc.id}`)}>
                  <span>{loc.location_name}</span>
                  <span className="muted">{[loc.city, loc.state].filter(Boolean).join(", ") || "No address"}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state empty-state--panel">No approved locations yet.</div>
        )}
      </section>

      <section className="request-card" aria-label="Operational notes">
        <div className="directory-card__header">
          <div>
            <strong>Notes</strong>
            <div className="muted">Durable operational notes for this organization.</div>
          </div>
        </div>
        <p>{org.notes?.trim() || "No notes saved."}</p>
      </section>
    </section>
  );
}

function ContactRecordDetail({ detail, header }: { detail: DirectoryContactDetailResponse; header: React.ReactNode }) {
  const c = detail.contact;
  const archived = c.contact_status === "archived" || c.active_status === "inactive";
  const relationships = c.relationship_history ?? [];

  return (
    <section className="record-detail" aria-label={`${c.full_name} detail`}>
      {header}
      <div className="request-card record-detail__hero">
        <DirectoryAvatar name={c.full_name} imageUrl={c.photo_url} kind="contact" size="lg" />
        <div>
          <p className="eyebrow">Contact</p>
          <h1>{c.full_name}</h1>
          <div className="directory-chip-row">
            {c.title ? <span className="meta-pill">{c.title}</span> : null}
            {c.email ? <span className="meta-pill">{c.email}</span> : null}
            {c.phone ? <span className="meta-pill">{c.phone}</span> : null}
          </div>
        </div>
      </div>
      <ArchivedBanner archived={archived} />

      <section className="request-card" aria-label="Organization relationships">
        <div className="directory-card__header">
          <div>
            <strong>Organization relationships ({relationships.length})</strong>
            <div className="muted">Every organization this person is connected to, with their contextual role.</div>
          </div>
        </div>
        {relationships.length ? (
          <ul className="record-detail__list">
            {relationships.map((r) => (
              <li key={r.id}>
                <button type="button" className="directory-link-button" onClick={() => (window.location.hash = `#directory/organizations/${r.organization_id}`)}>
                  <span>{r.organization_display_name}{r.relationship_role ? ` — ${r.relationship_role.replace(/_/g, " ")}` : ""}</span>
                  <span className="muted">{r.is_current ? "Current" : "Previous"}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state empty-state--panel">No organization relationships recorded.</div>
        )}
      </section>

      <section className="request-card" aria-label="Contact notes">
        <div className="directory-card__header">
          <div>
            <strong>Notes</strong>
          </div>
        </div>
        <p>{c.notes?.trim() || "No contact notes saved."}</p>
      </section>
    </section>
  );
}

function LocationRecordDetail({ location, header }: { location: DirectoryLocationSummary; header: React.ReactNode }) {
  const archived = location.active_status === "inactive";
  const address = useMemo(
    () => [location.address_line_1, location.address_line_2, [location.city, location.state, location.zip].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
    [location]
  );
  return (
    <section className="record-detail" aria-label={`${location.location_name} detail`}>
      {header}
      <div className="request-card record-detail__hero">
        <div>
          <p className="eyebrow">Location</p>
          <h1>{location.location_name}</h1>
          <div className="directory-chip-row">
            <span className="meta-pill">{labelForActiveStatus(location.active_status)}</span>
            {location.organization_display_name ? <span className="meta-pill">{location.organization_display_name}</span> : null}
          </div>
        </div>
      </div>
      <ArchivedBanner archived={archived} />

      <section className="request-card" aria-label="Address">
        <div className="directory-card__header">
          <div>
            <strong>Address</strong>
          </div>
        </div>
        <p>{address || "No address on file."}</p>
        {location.notes?.trim() ? <p className="muted">{location.notes}</p> : null}
      </section>

      <section className="request-card" aria-label="Location intelligence">
        <div className="directory-card__header">
          <div>
            <strong>Location Intelligence</strong>
            <div className="muted">Observations, evaluations, surveys, and warnings.</div>
          </div>
        </div>
        <div className="empty-state empty-state--panel">
          Location Intelligence opens in the focused location workspace.{" "}
          <button type="button" className="link-button" onClick={() => (window.location.hash = `#directory/locations?location=${location.id}`)}>
            Open in workspace
          </button>
          <div className="muted">Updated {location.updated_at ? formatDateLabel(location.updated_at) : "—"}</div>
        </div>
      </section>
    </section>
  );
}
