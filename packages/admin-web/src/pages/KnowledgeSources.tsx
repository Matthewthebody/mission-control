import { useCallback, useEffect, useState } from "react";
import {
  createSource,
  deleteSynonymApi,
  getKnowledgeHealthApi,
  listSources,
  listSynonymsApi,
  previewSynonyms,
  upsertSynonymApi,
  type KnowledgeHealth,
  type SourceListResult,
  type SynonymRow
} from "../services/knowledgeAuthoringApi";

// Knowledge Sources workspace (H5-B/G) — the reviewer's operational desk:
// search/filter the governed source list, watch knowledge health, author a
// new inline source (draft until approved), and manage retrieval synonyms.
// Server-side gating: every endpoint here is reviewer-only.

type Props = { token: string };

const STATUS_OPTIONS = ["", "approved", "pending_review", "draft", "rejected", "superseded", "retired"];
const AUTHORITY_OPTIONS = [
  "",
  "official_company_policy",
  "approved_sop",
  "approved_training",
  "approved_expert_guidance",
  "approved_visual_standard",
  "verified_current_workflow",
  "future_design_only",
  "historical_only"
];

function sourceHash(id: string) {
  return `#knowledge/sources/${id}`;
}

function HealthStrip({ health }: { health: KnowledgeHealth }) {
  const entries: Array<[string, number]> = [
    ["Active approved", health.counts.active_approved],
    ["Pending review", health.counts.pending_review],
    ["Overdue review", health.counts.overdue_review],
    ["Expiring soon", health.counts.expiring_soon],
    ["Open conflicts", health.counts.open_conflicts],
    ["Failed ingestion", health.counts.failed_ingestion],
    ["Failed embeddings", health.counts.failed_embeddings],
    ["Open questions", health.counts.open_questions],
    ["Open reports", health.counts.open_reports]
  ];
  return (
    <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }} aria-label="Knowledge health">
      {entries.map(([label, value]) => (
        <span key={label} className="badge-pill">
          {label}: {value}
        </span>
      ))}
    </div>
  );
}

function SynonymManager({ token, onError }: { token: string; onError: (message: string) => void }) {
  const [synonyms, setSynonyms] = useState<SynonymRow[]>([]);
  const [term, setTerm] = useState("");
  const [expansion, setExpansion] = useState("");
  const [preview, setPreview] = useState("");
  const [previewResult, setPreviewResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSynonyms((await listSynonymsApi(token)).synonyms);
    } catch {
      // Synonym list failures are non-fatal to the workspace.
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    const words = expansion
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!term.trim() || words.length === 0) return;
    // Duplicate detection: an existing term will be updated, warn first.
    const existing = synonyms.find((row) => row.term === term.trim().toLowerCase());
    if (existing && !window.confirm(`'${existing.term}' already maps to [${existing.expansion.join(", ")}]. Replace it?`)) {
      return;
    }
    try {
      await upsertSynonymApi(token, { term: term.trim(), expansion: words });
      setTerm("");
      setExpansion("");
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Saving the synonym failed.");
    }
  };

  const runPreview = async () => {
    if (!preview.trim()) return;
    try {
      const result = await previewSynonyms(token, preview);
      setPreviewResult(
        result.concepts
          .map((concept) => `${concept.term}${concept.from_synonym ? ` → [${concept.variants.join(", ")}]` : ""}`)
          .join(" · ")
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Preview failed.");
    }
  };

  return (
    <section className="panel">
      <div className="section-title">Retrieval synonyms ({synonyms.length})</div>
      <p className="section-subtitle">
        Company-owned acronym and synonym mappings. They widen retrieval only — they never change source authority or
        create policy. Every change is audited.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <input aria-label="Synonym term" placeholder="term (e.g. ss)" value={term} onChange={(event) => setTerm(event.target.value)} />
        <input
          aria-label="Synonym expansion"
          placeholder="expansions, comma separated (e.g. smart shooter)"
          value={expansion}
          onChange={(event) => setExpansion(event.target.value)}
          style={{ minWidth: 260 }}
        />
        <button type="button" className="primary-button" onClick={() => void save()}>
          Save synonym
        </button>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: "0.5rem 0", display: "grid", gap: "0.25rem" }}>
        {synonyms.map((row) => (
          <li key={row.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <span className="badge-pill">{row.term}</span>
            <span>→ {row.expansion.join(", ")}</span>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void deleteSynonymApi(token, row.term).then(refresh)}
              aria-label={`Retire synonym ${row.term}`}
            >
              Retire
            </button>
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          aria-label="Normalization preview"
          placeholder="Test how a question normalizes…"
          value={preview}
          onChange={(event) => setPreview(event.target.value)}
          style={{ minWidth: 260 }}
        />
        <button type="button" className="secondary-button" onClick={() => void runPreview()}>
          Preview normalization
        </button>
      </div>
      {previewResult ? <p className="section-subtitle" style={{ marginTop: "0.4rem" }}>{previewResult}</p> : null}
    </section>
  );
}

export default function KnowledgeSources({ token }: Props) {
  const [result, setResult] = useState<SourceListResult | null>(null);
  const [health, setHealth] = useState<KnowledgeHealth | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [authority, setAuthority] = useState("");
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAuthority, setNewAuthority] = useState("approved_sop");
  const [newBody, setNewBody] = useState("");

  const refresh = useCallback(async () => {
    try {
      setResult(await listSources(token, { query, status, authority, limit: 25, offset }));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load the source list.");
    }
  }, [token, query, status, authority, offset]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    getKnowledgeHealthApi(token).then(setHealth).catch(() => setHealth(null));
  }, [token]);

  const createNewSource = async () => {
    if (!newTitle.trim() || !newBody.trim()) return;
    try {
      const created = await createSource(token, {
        title: newTitle.trim(),
        source_type: "written_sop",
        authority_class: newAuthority,
        inline_body: newBody
      });
      window.location.hash = sourceHash(created.source_id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Creating the source failed.");
    }
  };

  return (
    <div className="workspace-shell knowledge-sources" style={{ display: "grid", gap: "1rem" }}>
      <section className="panel">
        <div className="section-title">Knowledge Sources</div>
        <p className="section-subtitle">
          The governed library behind Ask Bailey. New content is a draft until approved; approved content is revised
          through new versions, never edited in place.
        </p>
        {health ? <HealthStrip health={health} /> : null}
        {error ? (
          <p role="alert" style={{ color: "var(--danger-color, #c53030)" }}>
            {error}
          </p>
        ) : null}
      </section>

      <section className="panel">
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <input
            aria-label="Search sources"
            placeholder="Search titles…"
            value={query}
            onChange={(event) => {
              setOffset(0);
              setQuery(event.target.value);
            }}
            style={{ minWidth: 220 }}
          />
          <select aria-label="Filter by status" value={status} onChange={(event) => { setOffset(0); setStatus(event.target.value); }}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === "" ? "Any status" : option.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <select aria-label="Filter by authority" value={authority} onChange={(event) => { setOffset(0); setAuthority(event.target.value); }}>
            {AUTHORITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === "" ? "Any authority" : option.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <button type="button" className="secondary-button" onClick={() => setShowCreate((current) => !current)}>
            {showCreate ? "Close new source" : "New source"}
          </button>
        </div>

        {showCreate ? (
          <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
            <input aria-label="New source title" placeholder="Title" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} />
            <select aria-label="New source authority" value={newAuthority} onChange={(event) => setNewAuthority(event.target.value)}>
              {AUTHORITY_OPTIONS.filter(Boolean).map((option) => (
                <option key={option} value={option}>
                  {option.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <textarea
              aria-label="New source body"
              placeholder="# Heading\n\nWrite the procedure…"
              rows={5}
              value={newBody}
              onChange={(event) => setNewBody(event.target.value)}
            />
            <div>
              <button type="button" className="primary-button" onClick={() => void createNewSource()}>
                Create draft source
              </button>
            </div>
          </div>
        ) : null}

        <p className="section-subtitle" style={{ margin: "0.75rem 0 0.25rem" }}>
          {result ? `${result.total} source${result.total === 1 ? "" : "s"} · showing ${result.sources.length}` : "Loading…"}
        </p>
        <div style={{ display: "grid", gap: "0.4rem" }}>
          {(result?.sources ?? []).map((row) => (
            <a
              key={row.id}
              href={sourceHash(row.id)}
              style={{
                border: "1px solid var(--border-color, #d9d4c8)",
                borderRadius: 8,
                padding: "0.5rem 0.75rem",
                textDecoration: "none",
                color: "inherit"
              }}
            >
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <strong>{row.title}</strong>
                {row.version_number ? <span className="badge-pill">v{row.version_number}</span> : null}
                {row.publication_status ? <span className="badge-pill">{row.publication_status.replace(/_/g, " ")}</span> : null}
                {row.authority_class ? <span className="badge-pill">{row.authority_class.replace(/_/g, " ")}</span> : null}
                {row.confidential ? <span className="badge-pill">confidential</span> : null}
              </div>
              <div style={{ fontSize: "0.8rem", opacity: 0.75 }}>
                {[row.source_type?.replace(/_/g, " "), row.owner_name, row.department_owner].filter(Boolean).join(" · ")}
              </div>
            </a>
          ))}
        </div>
        {result && result.total > result.offset + result.sources.length ? (
          <button type="button" className="secondary-button" style={{ marginTop: "0.5rem" }} onClick={() => setOffset(offset + 25)}>
            Next page
          </button>
        ) : null}
        {offset > 0 ? (
          <button type="button" className="secondary-button" style={{ marginTop: "0.5rem", marginLeft: "0.5rem" }} onClick={() => setOffset(Math.max(0, offset - 25))}>
            Previous page
          </button>
        ) : null}
      </section>

      {health && (health.top_unanswered.length > 0 || health.most_cited.length > 0 || health.most_reported.length > 0) ? (
        <section className="panel">
          <div className="section-title">Knowledge health details</div>
          {health.top_unanswered.length > 0 ? (
            <>
              <strong>Most-asked unanswered questions</strong>
              <ul>
                {health.top_unanswered.map((row) => (
                  <li key={row.example_question}>
                    {row.example_question} <span className="badge-pill">×{row.occurrence_count}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {health.most_cited.length > 0 ? (
            <>
              <strong>Most-cited sources</strong>
              <ul>
                {health.most_cited.map((row) => (
                  <li key={row.id}>
                    <a href={sourceHash(row.id)}>{row.title}</a> <span className="badge-pill">{row.citations} citations</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {health.most_reported.length > 0 ? (
            <>
              <strong>Most-reported sources</strong>
              <ul>
                {health.most_reported.map((row) => (
                  <li key={row.id}>
                    <a href={sourceHash(row.id)}>{row.title}</a> <span className="badge-pill">{row.reports} reports</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      <SynonymManager token={token} onError={setError} />
    </div>
  );
}
