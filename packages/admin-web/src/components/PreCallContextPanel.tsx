import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../api";
import type { PreCallContextDefinition, PreCallContextTone } from "../preCallContextTypes";
import type { RecordResourceItem } from "../recordResourcesTypes";
import { listRecordResources } from "../services/recordResourcesApi";

type Props = {
  token: string;
  definition: PreCallContextDefinition;
};

function toneClassName(tone: PreCallContextTone | null | undefined) {
  switch (tone) {
    case "critical":
      return "pre-call-context-panel__item--critical";
    case "warning":
      return "pre-call-context-panel__item--warning";
    case "success":
      return "pre-call-context-panel__item--success";
    default:
      return "";
  }
}

function humanizeToken(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildResourceMeta(item: RecordResourceItem) {
  return [humanizeToken(item.category), humanizeToken(item.reference_kind), item.uploaded_by_name].filter(Boolean).join(" | ");
}

export function PreCallContextPanel({ token, definition }: Props) {
  const [resources, setResources] = useState<RecordResourceItem[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [resourceError, setResourceError] = useState("");

  const resourceTarget = definition.resourceTarget ?? null;

  useEffect(() => {
    if (!resourceTarget) {
      setResources([]);
      setLoadingResources(false);
      setResourceError("");
      return;
    }
    let cancelled = false;
    setLoadingResources(true);
    void listRecordResources(token, resourceTarget.objectType, resourceTarget.objectId)
      .then((payload) => {
        if (!cancelled) {
          setResources(payload.items.slice(0, 3));
          setResourceError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setResources([]);
          setResourceError(
            loadError instanceof ApiClientError ? loadError.message : "Linked files are temporarily unavailable."
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingResources(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resourceTarget?.objectId, resourceTarget?.objectType, token]);

  const visibleSections = useMemo(
    () => definition.sections.filter((section) => section.items.length || section.emptyLabel),
    [definition.sections]
  );

  const hasContext =
    Boolean(definition.callReason) ||
    visibleSections.some((section) => section.items.length > 0) ||
    Boolean(resourceTarget && (resources.length || loadingResources || resourceError));

  return (
    <section className="pre-call-context-panel">
      <div className="pre-call-context-panel__header">
        <div>
          <h4>{definition.title ?? "Pre-Call Context"}</h4>
          <p>{definition.summary ?? "Review the operational basics before launching the Teams meeting."}</p>
        </div>
      </div>

      {definition.callReason ? (
        <div className="pre-call-context-panel__reason">
          <span>{definition.callReasonLabel ?? "Call reason"}</span>
          <strong>{definition.callReason}</strong>
        </div>
      ) : null}

      {visibleSections.length ? (
        <div className="pre-call-context-panel__sections">
          {visibleSections.map((section) => (
            <article key={section.key} className="pre-call-context-panel__section">
              <h5>{section.title}</h5>
              {section.items.length ? (
                <div className="pre-call-context-panel__items">
                  {section.items.map((item) => (
                    <div
                      key={`${section.key}-${item.label}-${item.value}`}
                      className={`pre-call-context-panel__item ${toneClassName(item.tone)}`.trim()}
                    >
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                      {item.detail ? <small>{item.detail}</small> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pre-call-context-panel__state">{section.emptyLabel}</div>
              )}
            </article>
          ))}
        </div>
      ) : null}

      {resourceTarget ? (
        <article className="pre-call-context-panel__section">
          <h5>{resourceTarget.title ?? "Linked Files"}</h5>
          {loadingResources ? <div className="pre-call-context-panel__state">Loading linked files...</div> : null}
          {!loadingResources && resourceError ? <div className="pre-call-context-panel__state">{resourceError}</div> : null}
          {!loadingResources && !resourceError && resources.length ? (
            <div className="pre-call-context-panel__resource-list">
              {resources.map((resource) => (
                <div key={resource.id} className="pre-call-context-panel__resource">
                  {resource.url ? (
                    <a href={resource.url} target="_blank" rel="noreferrer">
                      {resource.title}
                    </a>
                  ) : (
                    <strong>{resource.title}</strong>
                  )}
                  <small>{buildResourceMeta(resource)}</small>
                  {resource.description ? <small>{resource.description}</small> : null}
                </div>
              ))}
            </div>
          ) : null}
          {!loadingResources && !resourceError && !resources.length ? (
            <div className="pre-call-context-panel__state">
              {resourceTarget.emptyLabel ?? "No linked files are attached to this record yet."}
            </div>
          ) : null}
        </article>
      ) : null}

      {!hasContext ? (
        <div className="pre-call-context-panel__state">
          {definition.emptyLabel ?? "No additional context has been saved for this call yet."}
        </div>
      ) : null}
    </section>
  );
}
