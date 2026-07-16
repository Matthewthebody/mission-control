import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getConversation,
  listConversations,
  type AskBaileyCitation,
  type ConversationDetail,
  type ConversationSummary
} from "../services/askBaileyApi";
import AskBaileyConversation, {
  AnswerBlocks,
  AnswerText,
  BaileyMark,
  SourceCard,
  StatusBadge
} from "../components/askBailey/AskBaileyConversation";

// Ask Bailey — the dedicated assistant page (general mode). The ask/answer
// surface is the SAME shared conversation component the contextual drawer
// uses (H4: one pipeline, one client surface); this page adds history and
// the About panel.

type Props = {
  token: string;
};

export default function AskBailey({ token }: Props) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [history, setHistory] = useState<ConversationDetail | null>(null);

  const refreshConversations = useCallback(async () => {
    try {
      const result = await listConversations(token);
      setConversations(result.conversations);
    } catch {
      // History is non-critical; the ask flow stays usable without it.
    }
  }, [token]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  const openConversation = useCallback(
    async (id: string) => {
      try {
        setHistory(await getConversation(token, id));
      } catch {
        setHistory(null);
      }
    },
    [token]
  );

  const citationsByMessage = useMemo(() => {
    const map = new Map<string, AskBaileyCitation[]>();
    for (const citation of history?.citations ?? []) {
      const list = map.get(citation.message_id) ?? [];
      list.push(citation);
      map.set(citation.message_id, list);
    }
    return map;
  }, [history]);

  return (
    <div className="workspace-shell ask-bailey" style={{ display: "grid", gap: "1rem" }}>
      <section className="panel">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
          <BaileyMark />
          <div>
            <div className="section-title" style={{ marginBottom: 0 }}>
              Ask Bailey
            </div>
            <p className="section-subtitle" style={{ margin: 0 }}>
              Your guide to how we do things at Kemmetmueller Photography.
            </p>
          </div>
        </div>
        <p className="section-subtitle" style={{ marginTop: 0 }}>
          I’ll check the approved playbook, training videos, and the Mission Control information you are allowed to
          see.
        </p>
        <AskBaileyConversation token={token} onAnswer={() => void refreshConversations()} />
      </section>

      {history ? (
        <section className="panel">
          <div className="section-title">Conversation</div>
          {history.messages.map((message) => (
            <div key={message.id} style={{ marginBottom: "1rem" }}>
              <p style={{ fontWeight: 600, margin: "0 0 0.25rem" }}>{message.question}</p>
              <StatusBadge status={message.status} />
              {message.answer_blocks && message.answer_blocks.length > 0 ? (
                <div style={{ marginTop: "0.5rem" }}>
                  <AnswerBlocks blocks={message.answer_blocks} />
                </div>
              ) : message.answer_markdown ? (
                <div style={{ marginTop: "0.5rem" }}>
                  <AnswerText text={message.answer_markdown} />
                </div>
              ) : null}
              {(citationsByMessage.get(message.id) ?? []).length > 0 ? (
                <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.5rem" }}>
                  {(citationsByMessage.get(message.id) ?? []).map((citation) => (
                    <SourceCard key={`${message.id}-${citation.segment_id}`} citation={citation} />
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <section className="panel">
        <div className="section-title">Recent conversations</div>
        {conversations.length === 0 ? (
          <p className="section-subtitle">No conversations yet. Ask your first question above.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.35rem" }}>
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ width: "100%", textAlign: "left" }}
                  onClick={() => void openConversation(conversation.id)}
                >
                  {conversation.title ?? "Untitled conversation"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>About Ask Bailey</summary>
          <p className="section-subtitle" style={{ marginTop: "0.5rem" }}>
            Ask Bailey is named for Bailey, Kemmetmueller Photography’s beloved black lab and longest-tenured
            employee. She spent more than a decade as part of the company’s daily life. Ask Bailey carries forward
            that same steady presence by helping our people find the right information when they need it. Every
            operational answer is grounded in approved sources — Bailey never invents company truth.
          </p>
        </details>
      </section>
    </div>
  );
}
