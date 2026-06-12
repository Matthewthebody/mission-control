import { useState, type FormEvent } from "react";
import {
  MISSION_CONTROL_ASSISTANT_SUGGESTIONS,
  askMissionControl,
  isMissionControlAssistantConfigured,
  type MissionControlAssistantResult
} from "../../services/missionControlAssistant";

type Props = {
  token: string;
};

export function MissionControlAssistant({ token }: Props) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<MissionControlAssistantResult | null>(null);
  const [pending, setPending] = useState(false);
  const configured = isMissionControlAssistantConfigured();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim() || pending) {
      return;
    }
    setPending(true);
    try {
      setResult(await askMissionControl(token, question));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel home-operational__assistant" aria-label="Ask Mission Control">
      <div className="home-operational__assistant-head">
        <div className="section-title">Ask Mission Control</div>
        <span className={`home-operational__assistant-status home-operational__assistant-status--${configured ? "live" : "preview"}`}>
          {configured ? "Connected" : "Preview · not connected"}
        </span>
      </div>
      <form className="home-operational__assistant-form" onSubmit={submit}>
        <input
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.currentTarget.value)}
          placeholder="Ask Mission Control anything…"
          aria-label="Ask Mission Control anything"
        />
        <button type="submit" className="primary-button" aria-label="Ask Mission Control" disabled={pending || !question.trim()}>
          {pending ? "Asking…" : "Ask"}
        </button>
      </form>
      <div className="home-operational__assistant-suggestions">
        {MISSION_CONTROL_ASSISTANT_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="home-operational__assistant-chip"
            onClick={() => setQuestion(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
      {result ? (
        <p className={`home-operational__assistant-answer home-operational__assistant-answer--${result.status}`} role="status">
          {result.message}
        </p>
      ) : null}
    </section>
  );
}
