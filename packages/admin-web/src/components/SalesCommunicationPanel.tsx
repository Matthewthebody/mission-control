import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { OperationalDetailSection } from "./OperationalDetailSection";
import type { SalesOpportunityStage, SalesOpportunityType, SalesPipelineType } from "../salesPipelineTypes";
import type {
  SalesEmailCommunicationRecord,
  SalesEmailCommunicationStatus,
  SalesEmailEventType,
  SalesEmailTemplateRecord
} from "../types";

type ContactOption = {
  id: string;
  full_name: string;
  email: string | null;
  title?: string | null;
};

type OpportunityContext = {
  id: string;
  stage: SalesOpportunityStage;
  pipeline_type: SalesPipelineType;
  opportunity_type: SalesOpportunityType;
  estimated_value: number | null;
  next_action_date: string | null;
};

type Props = {
  title?: string;
  summary?: string;
  templates: SalesEmailTemplateRecord[];
  communications: SalesEmailCommunicationRecord[];
  contacts: ContactOption[];
  organizationId: string;
  organizationName: string;
  senderName: string;
  opportunity?: OpportunityContext | null;
  defaultContactId?: string | null;
  canSend: boolean;
  sending?: boolean;
  onSend?: (input: {
    organization_id: string;
    opportunity_id?: string | null;
    contact_id: string;
    template_id: string;
    subject: string;
    body: string;
  }) => Promise<void>;
};

export function SalesCommunicationPanel({
  title = "Communication History",
  summary = "Templated outreach, queued sends, and delivery history tied to this record.",
  templates,
  communications,
  contacts,
  organizationId,
  organizationName,
  senderName,
  opportunity,
  defaultContactId,
  canSend,
  sending = false,
  onSend
}: Props) {
  const firstReachableContactId = contacts.find((contact) => contact.email)?.id ?? contacts[0]?.id ?? "";
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [contactId, setContactId] = useState(defaultContactId ?? firstReachableContactId);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId) ?? templates[0] ?? null,
    [templateId, templates]
  );
  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === contactId) ?? contacts[0] ?? null,
    [contactId, contacts]
  );

  useEffect(() => {
    if (!templates.length) {
      setTemplateId("");
      return;
    }
    if (!templates.some((template) => template.id === templateId)) {
      setTemplateId(templates[0]?.id ?? "");
    }
  }, [templateId, templates]);

  useEffect(() => {
    if (!contacts.length) {
      setContactId("");
      return;
    }
    if (defaultContactId && contacts.some((contact) => contact.id === defaultContactId)) {
      setContactId(defaultContactId);
      return;
    }
    if (!contacts.some((contact) => contact.id === contactId)) {
      setContactId(firstReachableContactId);
    }
  }, [contactId, contacts, defaultContactId, firstReachableContactId]);

  useEffect(() => {
    if (!selectedTemplate || !selectedContact) {
      setSubject("");
      setBody("");
      return;
    }
    const mergeContext = buildMergeContext({
      organizationName,
      contactName: selectedContact.full_name,
      senderName,
      opportunity
    });
    setSubject(renderMergeTemplate(selectedTemplate.subject_template, mergeContext));
    setBody(renderMergeTemplate(selectedTemplate.body_template, mergeContext));
  }, [opportunity, organizationName, selectedContact, selectedTemplate, senderName]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!selectedTemplate) {
      setError("Choose an email template before sending.");
      return;
    }
    if (!selectedContact) {
      setError("Choose a Contact before sending.");
      return;
    }
    if (!selectedContact.email) {
      setError("The selected Contact does not have an email address.");
      return;
    }
    if (!subject.trim() || !body.trim() || !onSend) {
      setError("Subject and body are required before sending.");
      return;
    }

    try {
      await onSend({
        organization_id: organizationId,
        opportunity_id: opportunity?.id ?? null,
        contact_id: selectedContact.id,
        template_id: selectedTemplate.id,
        subject: subject.trim(),
        body: body.trim()
      });
      setNotice("Email queued for delivery.");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "We couldn't queue this email.");
    }
  }

  return (
    <OperationalDetailSection title={title} summary={summary} defaultOpen>
      {canSend ? (
        <form className="dashboard-stack" onSubmit={handleSubmit}>
          <div className="field-grid">
            <label className="filter-field">
              <span>Template</span>
              <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                {!templates.length ? <option value="">No templates available</option> : null}
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.template_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Contact</span>
              <select value={contactId} onChange={(event) => setContactId(event.target.value)}>
                {!contacts.length ? <option value="">No Contacts linked</option> : null}
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.full_name}
                    {contact.email ? ` | ${contact.email}` : " | Missing email"}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field filter-field--wide">
              <span>Subject</span>
              <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Email subject" />
            </label>
            <label className="filter-field filter-field--wide">
              <span>Body</span>
              <textarea rows={8} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Templated email body" />
            </label>
          </div>
          {selectedTemplate ? (
            <div className="muted">
              Merge fields: {selectedTemplate.merge_fields.length ? selectedTemplate.merge_fields.join(", ") : "No merge fields on this template."}
            </div>
          ) : null}
          {error ? <div className="error-banner">{error}</div> : null}
          {notice ? <div className="success-banner">{notice}</div> : null}
          <div className="access-actions">
            <button
              type="submit"
              disabled={sending || !selectedTemplate || !selectedContact || !selectedContact.email || !subject.trim() || !body.trim()}
            >
              {sending ? "Queueing..." : "Send Email"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="detail-two-column">
        {communications.map((communication) => (
          <article key={communication.id} className="request-card">
            <strong>{communication.subject}</strong>
            <div className="muted">
              {communication.contact_name || "Unknown Contact"}
              {communication.contact_email ? ` | ${communication.contact_email}` : ""}
            </div>
            <div className="muted">
              {humanizeCommunicationStatus(communication.status)} | {communication.template_name || "Manual email"}
              {communication.sent_at ? ` | Sent ${formatDateTime(communication.sent_at)}` : ` | Queued ${formatDateTime(communication.queued_at)}`}
            </div>
            {communication.provider_error_state ? <div className="muted">{communication.provider_error_state}</div> : null}
            <div className="muted">{communication.body}</div>
            <div className="timeline-list">
              {communication.events.map((eventItem) => (
                <div key={eventItem.id} className="timeline-item">
                  <div className="timeline-dot" />
                  <div>
                    <div className="timeline-title">
                      <span className="timeline-type">{humanizeCommunicationEvent(eventItem.event_type)}</span>
                      <span className="muted">{formatDateTime(eventItem.timestamp)}</span>
                    </div>
                    <div className="muted">
                      {eventItem.actor_name || "System"}
                      {eventItem.note ? ` | ${eventItem.note}` : ""}
                    </div>
                  </div>
                </div>
              ))}
              {!communication.events.length ? <div className="empty-state">No timeline events were recorded for this email yet.</div> : null}
            </div>
          </article>
        ))}
        {!communications.length ? <div className="empty-state">No communication history is attached yet.</div> : null}
      </div>
    </OperationalDetailSection>
  );
}

function buildMergeContext(input: {
  organizationName: string;
  contactName: string;
  senderName: string;
  opportunity?: OpportunityContext | null;
}) {
  return {
    organization_name: input.organizationName,
    contact_name: input.contactName,
    sender_name: input.senderName,
    estimated_value: formatCurrency(input.opportunity?.estimated_value ?? null),
    next_action_date: input.opportunity?.next_action_date ? formatShortDate(input.opportunity.next_action_date) : "Not scheduled",
    opportunity_stage: input.opportunity ? humanizeToken(input.opportunity.stage) : "Not linked",
    pipeline_type: input.opportunity ? (input.opportunity.pipeline_type === "schools" ? "Schools Pipeline" : "Sports Pipeline") : "Not linked",
    opportunity_type: input.opportunity ? humanizeToken(input.opportunity.opportunity_type) : "Not linked"
  };
}

function renderMergeTemplate(template: string, context: Record<string, string>) {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, token: string) => context[token] ?? "");
}

function humanizeCommunicationStatus(status: SalesEmailCommunicationStatus) {
  return humanizeToken(status);
}

function humanizeCommunicationEvent(eventType: SalesEmailEventType) {
  return humanizeToken(eventType);
}

function humanizeToken(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatShortDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString();
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
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
