import { FormEvent, useEffect, useMemo, useState } from "react";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import type {
  AccountServiceType,
  ClientAccountDetail,
  ClientCommandCenterDashboard,
  ClientContactRole,
  ClientOrganizationSummary,
  ClientOrganizationType
} from "../clientCommandCenterTypes";
import {
  assignClientOwner,
  attachClientContactRelationship,
  createClientAccount,
  createClientAccountNote,
  createClientAccountTask,
  createClientContact,
  createClientOrganization,
  getClientAccountDetail,
  getClientCommandCenterDashboard,
  upsertClientAccountService
} from "../services/clientCommandCenter";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type LoadState = "loading" | "ready" | "error";

const ORGANIZATION_TYPES: Array<{ value: ClientOrganizationType; label: string }> = [
  { value: "school_district", label: "School District" },
  { value: "sports_association", label: "Sports Association" },
  { value: "league", label: "League" },
  { value: "company", label: "Company" },
  { value: "nonprofit", label: "Nonprofit" },
  { value: "other", label: "Other" }
];

const ACCOUNT_TYPES: Array<{ value: ClientOrganizationType; label: string }> = [
  { value: "elementary_school", label: "Elementary School" },
  { value: "middle_school", label: "Middle School" },
  { value: "high_school", label: "High School" },
  { value: "school", label: "School" },
  { value: "sports_association", label: "Sports Association" },
  { value: "studio_client", label: "Studio Client" },
  { value: "corporate_client", label: "Corporate Client" },
  { value: "league", label: "League" },
  { value: "other", label: "Other" }
];

const CONTACT_ROLES: Array<{ value: ClientContactRole; label: string }> = [
  { value: "primary_contact", label: "Primary Contact" },
  { value: "primary_decision_maker", label: "Primary Decision Maker" },
  { value: "principal", label: "Principal" },
  { value: "head_secretary", label: "Head Secretary" },
  { value: "secretary_admin_assistant", label: "Secretary / Admin Assistant" },
  { value: "picture_day_contact", label: "Picture Day Contact" },
  { value: "picture_day_prep_recipient", label: "Picture Day Prep Recipient" },
  { value: "day_before_reminder_recipient", label: "Day-Before Reminder Recipient" },
  { value: "yearbook_contact", label: "Yearbook Contact" },
  { value: "billing_contact", label: "Billing Contact" },
  { value: "gallery_recipient", label: "Gallery Recipient" },
  { value: "contract_recipient", label: "Contract Recipient" },
  { value: "emergency_day_of_contact", label: "Emergency Day-of Contact" },
  { value: "approval_contact", label: "Approval Contact" },
  { value: "athletic_director", label: "Athletic Director" },
  { value: "coach", label: "Coach" },
  { value: "other", label: "Other" }
];

const SERVICE_TYPES: Array<{ value: AccountServiceType; label: string }> = [
  { value: "fall_pictures", label: "Fall Pictures" },
  { value: "retakes", label: "Retakes" },
  { value: "spring_pictures", label: "Spring Pictures" },
  { value: "graduation", label: "Graduation" },
  { value: "yearbook", label: "Yearbook" },
  { value: "id_cards", label: "ID Cards" },
  { value: "sports", label: "Sports" },
  { value: "groups", label: "Groups" },
  { value: "staff_photos", label: "Staff Photos" },
  { value: "studio_work", label: "Studio Work" },
  { value: "corporate_headshots", label: "Corporate Headshots" },
  { value: "other", label: "Other" }
];

function parseAccountIdFromHash() {
  const match = window.location.hash.match(/^#client-command-center\/accounts\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function pretty(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Not set";
}

function readinessClass(account: ClientOrganizationSummary) {
  if (account.readiness_issue_count > 2) {
    return "client-command-center-account-card--critical";
  }
  if (account.readiness_issue_count > 0) {
    return "client-command-center-account-card--warning";
  }
  return "client-command-center-account-card--ready";
}

function readinessTone(status: ClientAccountDetail["readiness"]["status"]) {
  if (status === "blocked") {
    return "danger";
  }
  if (status === "needs_attention") {
    return "warning";
  }
  return "success";
}

function readinessHeadline(check: ClientAccountDetail["readiness"]["checks"][number]) {
  if (check.passed) {
    return `Ready: ${check.label}`;
  }
  return `Missing: ${check.label}`;
}

function contactMethodSummary(contact: ClientAccountDetail["contacts"][number]) {
  return [
    contact.email ? `Email: ${contact.email}` : null,
    contact.mobile_phone ? `Mobile: ${contact.mobile_phone}` : null,
    contact.office_phone ? `Office: ${contact.office_phone}` : null,
    contact.phone ? `Phone: ${contact.phone}` : null
  ].filter(Boolean).join(" | ") || "No contact method";
}

function locationAddressSummary(location: ClientAccountDetail["locations"][number]) {
  return location.address_display || [location.address_line_1, location.address_line_2, [location.city, location.state].filter(Boolean).join(", "), location.zip].filter(Boolean).join(", ") || "Address not set";
}

function locationPrepItems(location: ClientAccountDetail["locations"][number]) {
  return [
    location.navigation_notes ? { label: "Navigation", value: location.navigation_notes } : null,
    location.parking_instructions ? { label: "Parking", value: location.parking_instructions } : null,
    location.entrance_instructions ? { label: "Entrance / check-in", value: location.entrance_instructions } : null,
    location.unloading_instructions ? { label: "Unloading", value: location.unloading_instructions } : null,
    location.setup_area ? { label: "Setup area", value: location.setup_area } : null,
    location.backup_indoor_location ? { label: "Backup indoor location", value: location.backup_indoor_location } : null,
    location.accessibility_notes ? { label: "Elevator / accessibility", value: location.accessibility_notes } : null,
    location.power_availability_notes ? { label: "Power", value: location.power_availability_notes } : null,
    location.wifi_cell_notes ? { label: "Wi-Fi / cell", value: location.wifi_cell_notes } : null,
    location.security_checkin_requirements ? { label: "Security", value: location.security_checkin_requirements } : null,
    location.weather_contingency_notes ? { label: "Weather plan", value: location.weather_contingency_notes } : null
  ].filter(Boolean) as Array<{ label: string; value: string }>;
}

function attachmentAudienceClass(audience: ClientAccountDetail["locations"][number]["reference_attachments"][number]["audience"]) {
  if (audience === "client_facing") {
    return "meta-pill meta-pill--success";
  }
  if (audience === "internal_only") {
    return "meta-pill meta-pill--critical";
  }
  return "meta-pill";
}

export function ClientCommandCenter({ token, currentUser }: Props) {
  const [status, setStatus] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState<ClientCommandCenterDashboard | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState(() => parseAccountIdFromHash());
  const [detail, setDetail] = useState<ClientAccountDetail | null>(null);
  const [search, setSearch] = useState("");
  const [busyAction, setBusyAction] = useState("");

  const [organizationName, setOrganizationName] = useState("");
  const [organizationType, setOrganizationType] = useState<ClientOrganizationType>("school_district");
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState<ClientOrganizationType>("high_school");
  const [parentOrganizationId, setParentOrganizationId] = useState("");
  const [contactFirstName, setContactFirstName] = useState("");
  const [contactLastName, setContactLastName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactMobilePhone, setContactMobilePhone] = useState("");
  const [contactOfficePhone, setContactOfficePhone] = useState("");
  const [contactAllowSms, setContactAllowSms] = useState(false);
  const [contactSmsConsentStatus, setContactSmsConsentStatus] = useState<"unknown" | "opted_in" | "opted_out" | "not_eligible">("unknown");
  const [contactRole, setContactRole] = useState<ClientContactRole>("primary_contact");
  const [serviceType, setServiceType] = useState<AccountServiceType>("fall_pictures");
  const [noteSummary, setNoteSummary] = useState("");
  const [taskTitle, setTaskTitle] = useState("");

  useEffect(() => {
    const handleHashChange = () => setSelectedAccountId(parseAccountIdFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const load = async (accountId = selectedAccountId) => {
    setStatus("loading");
    setError("");
    try {
      const dashboardPayload = await getClientCommandCenterDashboard(token);
      const detailPayload = accountId ? await getClientAccountDetail(token, accountId) : null;
      setDashboard(dashboardPayload);
      setDetail(detailPayload);
      setStatus("ready");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Client Command Center failed to load.");
      setStatus("error");
    }
  };

  useEffect(() => {
    void load(selectedAccountId);
  }, [selectedAccountId, token]);

  const filteredAccounts = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    const accounts = dashboard?.accounts ?? [];
    if (!normalized) {
      return accounts;
    }
    return accounts.filter((account) =>
      [account.name, account.parent_organization_name, account.studio_bestie_name, account.client_organization_type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized))
    );
  }, [dashboard?.accounts, search]);

  const withAction = async (label: string, action: () => Promise<void>) => {
    setBusyAction(label);
    setError("");
    try {
      await action();
      await load(parseAccountIdFromHash());
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `${label} failed.`);
    } finally {
      setBusyAction("");
    }
  };

  const submitOrganization = (event: FormEvent) => {
    event.preventDefault();
    if (!organizationName.trim()) {
      return;
    }
    void withAction("Create organization", async () => {
      await createClientOrganization(token, {
        name: organizationName,
        organization_type: organizationType,
        status: "active"
      });
      setOrganizationName("");
    });
  };

  const submitAccount = (event: FormEvent) => {
    event.preventDefault();
    if (!accountName.trim()) {
      return;
    }
    void withAction("Create account", async () => {
      const created = await createClientAccount(token, {
        organization_id: parentOrganizationId || null,
        name: accountName,
        account_type: accountType,
        status: "active"
      });
      setAccountName("");
      window.location.hash = `#client-command-center/accounts/${created.account.id}`;
    });
  };

  const submitContact = (event: FormEvent) => {
    event.preventDefault();
    if (!detail || !contactFirstName.trim() || !contactLastName.trim()) {
      return;
    }
    void withAction("Attach contact", async () => {
      const contact = await createClientContact(token, {
        account_id: detail.account.id,
        first_name: contactFirstName,
        last_name: contactLastName,
        email: contactEmail || null,
        phone: contactPhone || null,
        mobile_phone: contactMobilePhone || null,
        office_phone: contactOfficePhone || null,
        preferred_contact_method: contactEmail ? "email" : contactMobilePhone ? "text" : contactPhone || contactOfficePhone ? "phone" : "unknown",
        allow_email: Boolean(contactEmail),
        allow_sms: contactAllowSms,
        allow_phone: Boolean(contactPhone || contactOfficePhone),
        sms_consent_status: contactSmsConsentStatus
      });
      await attachClientContactRelationship(token, {
        account_id: detail.account.id,
        contact_id: contact.id,
        roles: [contactRole],
        is_primary: contactRole === "primary_contact"
      });
      setContactFirstName("");
      setContactLastName("");
      setContactEmail("");
      setContactPhone("");
      setContactMobilePhone("");
      setContactOfficePhone("");
      setContactAllowSms(false);
      setContactSmsConsentStatus("unknown");
    });
  };

  const submitService = (event: FormEvent) => {
    event.preventDefault();
    if (!detail) {
      return;
    }
    void withAction("Add service", async () => {
      await upsertClientAccountService(token, detail.account.id, { service_type: serviceType, status: "active" });
    });
  };

  const assignCurrentUser = () => {
    if (!detail) {
      return;
    }
    void withAction("Assign Studio Bestie", async () => {
      await assignClientOwner(token, {
        account_id: detail.account.id,
        owner_user_id: currentUser.id,
        owner_type: "studio_bestie",
        notes: "Assigned from Client Command Center."
      });
    });
  };

  const submitNote = (event: FormEvent) => {
    event.preventDefault();
    if (!detail || !noteSummary.trim()) {
      return;
    }
    void withAction("Add note", async () => {
      await createClientAccountNote(token, detail.account.id, { summary: noteSummary });
      setNoteSummary("");
    });
  };

  const submitTask = (event: FormEvent) => {
    event.preventDefault();
    if (!detail || !taskTitle.trim()) {
      return;
    }
    void withAction("Create client task", async () => {
      await createClientAccountTask(token, detail.account.id, {
        title: taskTitle,
        priority: "normal",
        service_type: serviceType,
        communication_type: "picture_day_prep"
      });
      setTaskTitle("");
    });
  };

  if (status === "loading") {
    return <WorkspaceLoadingBlock title="Loading Client Command Center" summary="Opening the shared client context layer." />;
  }

  return (
    <main className="workspace-page client-command-center-page">
      <WorkspacePageHeader
        eyebrow="Client Command Center"
        title="Customer Brain"
        summary="Relationship-first customer context for accounts, contacts, services, owners, readiness, notes, tasks, and future communication workflows."
      />

      {error ? (
        <section className="panel client-command-center-alert">
          <div className="section-title">Something needs attention</div>
          <p className="section-subtitle">{error}</p>
        </section>
      ) : null}

      <section className="client-command-center-hero-grid">
        <article className="panel">
          <div className="section-title">Customer Status</div>
          <p className="section-subtitle">Quick readout from account records: active accounts, readiness gaps, owners, and upcoming jobs.</p>
          <div className="client-command-center-metric-grid">
            <div>
              <span className="metric-label">Active Accounts</span>
              <strong>{dashboard?.summary.active_accounts ?? 0}</strong>
            </div>
            <div>
              <span className="metric-label">Readiness Issues</span>
              <strong>{dashboard?.summary.readiness_issues ?? 0}</strong>
            </div>
            <div>
              <span className="metric-label">Missing Studio Bestie</span>
              <strong>{dashboard?.summary.accounts_missing_studio_bestie ?? 0}</strong>
            </div>
            <div>
              <span className="metric-label">Upcoming Jobs</span>
              <strong>{dashboard?.summary.accounts_with_upcoming_jobs ?? 0}</strong>
            </div>
          </div>
        </article>

        <article className="panel client-command-center-microsoft-card">
          <div className="section-title">Communication-ready, not auto-sending</div>
          <p className="section-subtitle">
            Readiness and events preserve account, contact, owner, service, task, and communication context for future message drafts and reminders.
          </p>
          <span className="badge">No external delivery in V1</span>
        </article>
      </section>

      <section className="client-command-center-layout">
        <aside className="panel client-command-center-sidebar">
          <div className="client-command-center-panel-heading">
            <div>
              <div className="section-title">Accounts</div>
              <p className="section-subtitle">Search by account, district, owner, or type.</p>
            </div>
            {dashboard?.generated_at ? <span className="badge">Updated {new Date(dashboard.generated_at).toLocaleTimeString()}</span> : null}
          </div>
          <input
            className="input"
            placeholder="Search clients..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="client-command-center-account-list">
            {filteredAccounts.length ? (
              filteredAccounts.map((account) => (
                <a
                  className={`client-command-center-account-card ${readinessClass(account)}`}
                  href={`#client-command-center/accounts/${account.id}`}
                  key={account.id}
                >
                  <strong>{account.name}</strong>
                  <span>{account.parent_organization_name ?? "No parent organization"}</span>
                  <small>
                    {account.readiness_issue_count ? `${account.readiness_issue_count} readiness issue${account.readiness_issue_count === 1 ? "" : "s"}` : "Communication-ready"}
                    {account.studio_bestie_name ? ` - Studio Bestie: ${account.studio_bestie_name}` : " - no Studio Bestie"}
                  </small>
                </a>
              ))
            ) : (
              <p className="section-subtitle">No accounts match this search yet. Add one below when you are ready.</p>
            )}
          </div>
        </aside>

        <section className="client-command-center-main">
          {detail ? (
            <AccountDetail
              detail={detail}
              currentUser={currentUser}
              busyAction={busyAction}
              contactFirstName={contactFirstName}
              contactLastName={contactLastName}
              contactEmail={contactEmail}
              contactPhone={contactPhone}
              contactMobilePhone={contactMobilePhone}
              contactOfficePhone={contactOfficePhone}
              contactAllowSms={contactAllowSms}
              contactSmsConsentStatus={contactSmsConsentStatus}
              contactRole={contactRole}
              serviceType={serviceType}
              noteSummary={noteSummary}
              taskTitle={taskTitle}
              onContactFirstName={setContactFirstName}
              onContactLastName={setContactLastName}
              onContactEmail={setContactEmail}
              onContactPhone={setContactPhone}
              onContactMobilePhone={setContactMobilePhone}
              onContactOfficePhone={setContactOfficePhone}
              onContactAllowSms={setContactAllowSms}
              onContactSmsConsentStatus={setContactSmsConsentStatus}
              onContactRole={setContactRole}
              onServiceType={setServiceType}
              onNoteSummary={setNoteSummary}
              onTaskTitle={setTaskTitle}
              onSubmitContact={submitContact}
              onSubmitService={submitService}
              onAssignCurrentUser={assignCurrentUser}
              onSubmitNote={submitNote}
              onSubmitTask={submitTask}
            />
          ) : (
            <section className="panel client-command-center-empty">
              <div className="section-title">Pick an account to open the customer brain</div>
              <p className="section-subtitle">
                You will see parent organization, services, key contacts, Studio Bestie ownership, readiness gaps, jobs, tasks, and timeline in one place.
              </p>
            </section>
          )}

          <section className="client-command-center-form-grid">
            <form className="panel client-command-center-form" onSubmit={submitOrganization}>
              <div className="section-title">Add parent organization</div>
              <p className="section-subtitle">Districts, leagues, associations, companies, and nonprofits.</p>
              <input className="input" placeholder="Wayzata School District" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} />
              <select className="input" value={organizationType} onChange={(event) => setOrganizationType(event.target.value as ClientOrganizationType)}>
                {ORGANIZATION_TYPES.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
              <button className="button button-primary" type="submit" disabled={Boolean(busyAction)}>{busyAction === "Create organization" ? "Saving..." : "Create Organization"}</button>
            </form>

            <form className="panel client-command-center-form" onSubmit={submitAccount}>
              <div className="section-title">Add account</div>
              <p className="section-subtitle">Schools, associations, studio clients, corporate clients, and accounts we actually serve.</p>
              <input className="input" placeholder="Wayzata High School" value={accountName} onChange={(event) => setAccountName(event.target.value)} />
              <select className="input" value={parentOrganizationId} onChange={(event) => setParentOrganizationId(event.target.value)}>
                <option value="">No parent organization</option>
                {(dashboard?.parent_organizations ?? []).map((organization) => <option value={organization.id} key={organization.id}>{organization.name}</option>)}
              </select>
              <select className="input" value={accountType} onChange={(event) => setAccountType(event.target.value as ClientOrganizationType)}>
                {ACCOUNT_TYPES.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
              <button className="button button-primary" type="submit" disabled={Boolean(busyAction)}>{busyAction === "Create account" ? "Saving..." : "Create Account"}</button>
            </form>
          </section>
        </section>
      </section>
    </main>
  );
}

function AccountDetail({
  detail,
  currentUser,
  busyAction,
  contactFirstName,
  contactLastName,
  contactEmail,
  contactPhone,
  contactMobilePhone,
  contactOfficePhone,
  contactAllowSms,
  contactSmsConsentStatus,
  contactRole,
  serviceType,
  noteSummary,
  taskTitle,
  onContactFirstName,
  onContactLastName,
  onContactEmail,
  onContactPhone,
  onContactMobilePhone,
  onContactOfficePhone,
  onContactAllowSms,
  onContactSmsConsentStatus,
  onContactRole,
  onServiceType,
  onNoteSummary,
  onTaskTitle,
  onSubmitContact,
  onSubmitService,
  onAssignCurrentUser,
  onSubmitNote,
  onSubmitTask
}: {
  detail: ClientAccountDetail;
  currentUser: SessionUser;
  busyAction: string;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone: string;
  contactMobilePhone: string;
  contactOfficePhone: string;
  contactAllowSms: boolean;
  contactSmsConsentStatus: "unknown" | "opted_in" | "opted_out" | "not_eligible";
  contactRole: ClientContactRole;
  serviceType: AccountServiceType;
  noteSummary: string;
  taskTitle: string;
  onContactFirstName: (value: string) => void;
  onContactLastName: (value: string) => void;
  onContactEmail: (value: string) => void;
  onContactPhone: (value: string) => void;
  onContactMobilePhone: (value: string) => void;
  onContactOfficePhone: (value: string) => void;
  onContactAllowSms: (value: boolean) => void;
  onContactSmsConsentStatus: (value: "unknown" | "opted_in" | "opted_out" | "not_eligible") => void;
  onContactRole: (value: ClientContactRole) => void;
  onServiceType: (value: AccountServiceType) => void;
  onNoteSummary: (value: string) => void;
  onTaskTitle: (value: string) => void;
  onSubmitContact: (event: FormEvent) => void;
  onSubmitService: (event: FormEvent) => void;
  onAssignCurrentUser: () => void;
  onSubmitNote: (event: FormEvent) => void;
  onSubmitTask: (event: FormEvent) => void;
}) {
  const primaryContact = detail.contacts.find((contact) => contact.is_primary || contact.client_roles.includes("primary_contact"));
  const emergencyContact = detail.contacts.find((contact) => contact.client_roles.includes("emergency_day_of_contact"));
  const secretary = detail.contacts.find((contact) => contact.client_roles.includes("head_secretary"));
  const principal = detail.contacts.find((contact) => contact.client_roles.includes("principal"));
  const studioBestie = detail.owners.find((owner) => owner.owner_type === "studio_bestie");

  return (
    <>
      <section className="panel client-command-center-detail">
        <a className="link-button" href="#client-command-center">Back to Client Command Center</a>
        <div className="client-command-center-detail__header">
          <div>
            <span className="badge">{pretty(detail.account.client_organization_type)}</span>
            <h2>{detail.account.name}</h2>
            <p className="section-subtitle">
              {detail.parent_organization?.name ?? "No parent organization"} - {detail.account.main_phone ?? detail.account.office_phone ?? "No phone on file"}
            </p>
          </div>
          <span className={`client-command-center-readiness-pill client-command-center-readiness-pill--${readinessTone(detail.readiness.status)}`}>
            {pretty(detail.readiness.status)}
          </span>
        </div>

        <div className="client-command-center-snapshot-grid">
          <Snapshot label="Principal" value={principal?.display_name ?? "Missing"} />
          <Snapshot label="Head Secretary" value={secretary?.display_name ?? "Missing"} />
          <Snapshot label="Emergency Day-of" value={emergencyContact?.display_name ?? "Missing"} />
          <Snapshot label="Studio Bestie" value={studioBestie?.owner_name ?? "Missing"} />
          <Snapshot label="Primary Contact" value={primaryContact?.display_name ?? "Missing"} />
          <Snapshot label="Services" value={detail.services.length ? detail.services.map((service) => pretty(service.service_type)).join(", ") : "No services set"} />
        </div>
      </section>

      <section className="client-command-center-detail-grid">
        <article className="panel">
          <div className="section-title">Communication Readiness</div>
          <p className="section-subtitle">
            Plain-English checklist for whether this account is ready for prep, reminders, billing, and day-of communication.
          </p>
          <div className="client-command-center-check-list">
            {detail.readiness.checks.map((check) => (
              <div className={check.passed ? "client-command-center-check client-command-center-check--pass" : "client-command-center-check client-command-center-check--fail"} key={check.code}>
                <strong>{readinessHeadline(check)}</strong>
                <span>{check.detail}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="section-title">Key Contacts</div>
          <p className="section-subtitle">Roles are attached to this relationship, not globally stamped on the person.</p>
          {detail.contacts.length ? (
            <div className="client-command-center-contact-list">
              {detail.contacts.map((contact) => (
                <div className="client-command-center-contact-row" key={contact.id}>
                  <div>
                    <strong>{contact.display_name}</strong>
                    <span>{contact.title ? `${contact.title} - ` : ""}{contact.client_roles.map(pretty).join(", ") || "No role set"}</span>
                    <small>{contactMethodSummary(contact)}</small>
                  </div>
                  <div className="client-command-center-contact-row__badges">
                    <span className={contact.active_status === "active" ? "meta-pill" : "meta-pill meta-pill--muted"}>{pretty(contact.active_status)}</span>
                    {contact.do_not_contact ? <span className="meta-pill meta-pill--critical">Do not contact</span> : null}
                    <span className={contact.prep_email_eligible ? "meta-pill meta-pill--success" : "meta-pill meta-pill--muted"} title={contact.prep_email_exclusion_reason ?? "Eligible for prep email"}>
                      Prep email {contact.prep_email_eligible ? "eligible" : "not ready"}
                    </span>
                    <span className={contact.prep_sms_eligible ? "meta-pill meta-pill--success" : "meta-pill meta-pill--muted"} title={contact.prep_sms_exclusion_reason ?? "Eligible for prep SMS"}>
                      Prep SMS {contact.prep_sms_eligible ? "eligible" : pretty(contact.sms_consent_status)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="section-subtitle">No contacts are attached yet. Add the first one below.</p>
          )}
        </article>

        <article className="panel">
          <div className="section-title">Locations and prep notes</div>
          <p className="section-subtitle">
            Structured location details for future client prep messages and employee shoot briefings. Internal-only notes are labeled and should never go to clients.
          </p>
          {detail.locations.length ? (
            <div className="client-command-center-location-list">
              {detail.locations.map((location) => {
                const prepItems = locationPrepItems(location);
                return (
                  <div className="client-command-center-location-card" key={location.id}>
                    <div className="client-command-center-location-card__header">
                      <div>
                        <strong>{location.location_name}</strong>
                        <span>{locationAddressSummary(location)}</span>
                      </div>
                      <div className="client-command-center-contact-row__badges">
                        <span className="meta-pill">{pretty(location.location_type)}</span>
                        <span className={location.active_status === "active" ? "meta-pill meta-pill--success" : "meta-pill meta-pill--muted"}>
                          {pretty(location.active_status)}
                        </span>
                        {location.google_maps_url ? (
                          <a className="secondary-button" href={location.google_maps_url} target="_blank" rel="noreferrer">
                            Open in Google Maps
                          </a>
                        ) : null}
                      </div>
                    </div>
                    {prepItems.length ? (
                      <div className="client-command-center-location-prep-grid">
                        {prepItems.map((item) => (
                          <div key={`${location.id}-${item.label}`}>
                            <span>{item.label}</span>
                            <strong>{item.value}</strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="section-subtitle">No operational prep notes yet.</p>
                    )}
                    <div className="client-command-center-note-audience-grid">
                      <div>
                        <span className="meta-pill meta-pill--success">Client-facing</span>
                        <p>{location.client_facing_notes ?? "No client-safe prep note set."}</p>
                      </div>
                      <div>
                        <span className="meta-pill">Employee-facing</span>
                        <p>{location.employee_facing_notes ?? "No employee briefing note set."}</p>
                      </div>
                      <div>
                        <span className="meta-pill meta-pill--critical">Internal-only</span>
                        <p>{location.internal_only_notes ?? "No internal-only reminder set."}</p>
                      </div>
                    </div>
                    {location.reference_attachments.length ? (
                      <div className="client-command-center-location-attachments" aria-label={`${location.location_name} reference attachments`}>
                        <span className="section-eyebrow">Reference attachments</span>
                        {location.reference_attachments.map((attachment) => (
                          <div className="client-command-center-location-attachment" key={attachment.id}>
                            <div>
                              <strong>{attachment.title}</strong>
                              <span>{pretty(attachment.attachment_type)}</span>
                              {attachment.description ? <p>{attachment.description}</p> : null}
                            </div>
                            <div className="client-command-center-contact-row__badges">
                              <span className={attachmentAudienceClass(attachment.audience)}>{pretty(attachment.audience)}</span>
                              {attachment.file_url ? (
                                <a className="secondary-button" href={attachment.file_url} target="_blank" rel="noreferrer">
                                  Open reference
                                </a>
                              ) : (
                                <span className="meta-pill meta-pill--muted">Stored reference</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="section-subtitle">No reusable locations are attached to this account yet.</p>
          )}
        </article>

        <article className="panel">
          <div className="section-title">Upcoming Jobs and Open Tasks</div>
          <div className="client-command-center-mini-list">
            {detail.upcoming_jobs.map((job) => (
              <div key={job.id}>
                <strong>{job.title}</strong>
                <span>{job.scheduled_start_at ? new Date(job.scheduled_start_at).toLocaleDateString() : "No scheduled date"} - {pretty(job.job_status)}</span>
              </div>
            ))}
            {detail.open_tasks.map((task) => (
              <div key={task.id}>
                <strong>{task.title}</strong>
                <span>{task.task_number} - {pretty(task.status)} - {task.assigned_to_name ?? "Unassigned"}</span>
              </div>
            ))}
            {!detail.upcoming_jobs.length && !detail.open_tasks.length ? <p className="section-subtitle">No upcoming jobs or open client tasks yet.</p> : null}
          </div>
        </article>

        <article className="panel">
          <div className="section-title">Activity Timeline</div>
          {detail.timeline.length ? (
            <div className="client-command-center-mini-list">
              {detail.timeline.map((item) => (
                <div key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.summary}</span>
                  <small>{new Date(item.occurred_at).toLocaleString()} {item.actor_name ? `- ${item.actor_name}` : ""}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="section-subtitle">No notes or task activity yet.</p>
          )}
        </article>
      </section>

      <section className="client-command-center-form-grid">
        <form className="panel client-command-center-form" onSubmit={onSubmitContact}>
          <div className="section-title">Attach contact</div>
          <p className="section-subtitle">Add the person and their role for this account.</p>
          <input className="input" placeholder="First name" value={contactFirstName} onChange={(event) => onContactFirstName(event.target.value)} />
          <input className="input" placeholder="Last name" value={contactLastName} onChange={(event) => onContactLastName(event.target.value)} />
          <input className="input" placeholder="Email" value={contactEmail} onChange={(event) => onContactEmail(event.target.value)} />
          <input className="input" placeholder="Mobile phone" value={contactMobilePhone} onChange={(event) => onContactMobilePhone(event.target.value)} />
          <input className="input" placeholder="Office phone" value={contactOfficePhone} onChange={(event) => onContactOfficePhone(event.target.value)} />
          <input className="input" placeholder="Other phone" value={contactPhone} onChange={(event) => onContactPhone(event.target.value)} />
          <select className="input" value={contactRole} onChange={(event) => onContactRole(event.target.value as ClientContactRole)}>
            {CONTACT_ROLES.map((role) => <option value={role.value} key={role.value}>{role.label}</option>)}
          </select>
          <label className="client-command-center-checkbox-row">
            <input type="checkbox" checked={contactAllowSms} onChange={(event) => onContactAllowSms(event.target.checked)} />
            Allow SMS for this contact
          </label>
          <select className="input" value={contactSmsConsentStatus} onChange={(event) => onContactSmsConsentStatus(event.target.value as "unknown" | "opted_in" | "opted_out" | "not_eligible")}>
            <option value="unknown">SMS consent unknown</option>
            <option value="opted_in">SMS opted in</option>
            <option value="opted_out">SMS opted out</option>
            <option value="not_eligible">SMS not eligible</option>
          </select>
          <button className="button button-primary" type="submit" disabled={Boolean(busyAction)}>{busyAction === "Attach contact" ? "Saving..." : "Attach Contact"}</button>
        </form>

        <form className="panel client-command-center-form" onSubmit={onSubmitService}>
          <div className="section-title">Services and ownership</div>
          <p className="section-subtitle">Services drive future communication readiness and reminders.</p>
          <select className="input" value={serviceType} onChange={(event) => onServiceType(event.target.value as AccountServiceType)}>
            {SERVICE_TYPES.map((service) => <option value={service.value} key={service.value}>{service.label}</option>)}
          </select>
          <button className="button button-primary" type="submit" disabled={Boolean(busyAction)}>{busyAction === "Add service" ? "Saving..." : "Add Service"}</button>
          <button className="button" type="button" onClick={onAssignCurrentUser} disabled={Boolean(busyAction)}>
            {busyAction === "Assign Studio Bestie" ? "Saving..." : `Make ${currentUser.fullName} Studio Bestie`}
          </button>
        </form>

        <form className="panel client-command-center-form" onSubmit={onSubmitNote}>
          <div className="section-title">Add note</div>
          <p className="section-subtitle">Notes go into the account timeline, not hidden fields.</p>
          <textarea className="input" placeholder="What should the team know?" value={noteSummary} onChange={(event) => onNoteSummary(event.target.value)} />
          <button className="button button-primary" type="submit" disabled={Boolean(busyAction)}>{busyAction === "Add note" ? "Saving..." : "Add Note"}</button>
        </form>

        <form className="panel client-command-center-form" onSubmit={onSubmitTask}>
          <div className="section-title">Create client-aware task</div>
          <p className="section-subtitle">Task context keeps account, service, communication, and source attached for future communication workflows.</p>
          <input className="input" placeholder="Follow up with secretary about prep email" value={taskTitle} onChange={(event) => onTaskTitle(event.target.value)} />
          <button className="button button-primary" type="submit" disabled={Boolean(busyAction)}>{busyAction === "Create client task" ? "Saving..." : "Create Task"}</button>
        </form>
      </section>
    </>
  );
}

function Snapshot({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
