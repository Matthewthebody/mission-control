import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import AskBaileyConversation, { BaileyMark, CONTEXT_KIND_LABELS, type AskBaileyRecordContext } from "./AskBaileyConversation";

// Ask Bailey launcher + contextual drawer (charter H4-B/C).
//
// One provider at the shell level owns the drawer; any page opens Bailey via
// useAskBailey().openAskBailey(context?) with a candidate {kind,id,label}.
// The context is only a CANDIDATE — the server validates kind, record, and
// access on every ask, and the conversation shows the server-confirmed
// context. Switching records remounts the conversation (fresh thread), so a
// prior record's context can never silently carry over.

type AskBaileyLauncherValue = {
  openAskBailey: (context?: AskBaileyRecordContext | null) => void;
  closeAskBailey: () => void;
};

const AskBaileyLauncherContext = createContext<AskBaileyLauncherValue>({
  openAskBailey: () => {},
  closeAskBailey: () => {}
});

export function useAskBailey(): AskBaileyLauncherValue {
  return useContext(AskBaileyLauncherContext);
}

function AskBaileyDrawer({
  token,
  userLine,
  context,
  onRemoveContext,
  onClose
}: {
  token: string;
  userLine: string | null;
  context: AskBaileyRecordContext | null;
  onRemoveContext: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Focus management: focus the close button on open, trap Tab inside the
  // dialog, restore the opener's focus on close (restoration happens in the
  // provider, which remembers the previously focused element).
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1200, display: "flex", justifyContent: "flex-end" }}
      onKeyDown={onKeyDown}
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(20, 20, 24, 0.35)" }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Ask Bailey"
        className="panel"
        style={{
          position: "relative",
          width: "min(440px, 100vw)",
          height: "100%",
          overflowY: "auto",
          borderRadius: 0,
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          padding: "1rem"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <BaileyMark size={32} />
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Ask Bailey</h2>
            <p className="section-subtitle" style={{ margin: 0, fontSize: "0.8rem" }}>
              {context ? `About this ${CONTEXT_KIND_LABELS[context.kind].toLowerCase()}` : "Your guide to how we do things"}
            </p>
          </div>
          <button ref={closeButtonRef} type="button" className="secondary-button" onClick={onClose} aria-label="Close Ask Bailey">
            Close
          </button>
        </div>
        {/* key: switching records remounts the conversation — a fresh thread
            with the new context, never a silent carry-over. Reopening the
            SAME record keeps the key and thus the thread (the server still
            revalidates context and permissions on every ask). */}
        <AskBaileyConversation
          key={context ? `${context.kind}:${context.id}` : "general"}
          token={token}
          recordContext={context}
          onRemoveContext={context ? onRemoveContext : undefined}
          userLine={userLine}
          compact
        />
      </div>
    </div>
  );
}

export function AskBaileyProvider({
  token,
  userLine,
  children
}: {
  token: string;
  userLine: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<AskBaileyRecordContext | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const openAskBailey = useCallback((nextContext?: AskBaileyRecordContext | null) => {
    restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    setContext(nextContext ?? null);
    setOpen(true);
  }, []);

  const closeAskBailey = useCallback(() => {
    setOpen(false);
    restoreFocusRef.current?.focus?.();
    restoreFocusRef.current = null;
  }, []);

  const value = useMemo(() => ({ openAskBailey, closeAskBailey }), [openAskBailey, closeAskBailey]);

  return (
    <AskBaileyLauncherContext.Provider value={value}>
      {children}
      {open ? (
        <AskBaileyDrawer
          token={token}
          userLine={userLine}
          context={context}
          onRemoveContext={() => setContext(null)}
          onClose={closeAskBailey}
        />
      ) : null}
    </AskBaileyLauncherContext.Provider>
  );
}

/** Reusable page launch button — one implementation for every detail page. */
export function AskBaileyLaunchButton({
  context,
  label
}: {
  context: AskBaileyRecordContext;
  label?: string;
}) {
  const { openAskBailey } = useAskBailey();
  return (
    <button
      type="button"
      className="secondary-button"
      onClick={() => openAskBailey(context)}
      aria-label={label ?? `Ask Bailey about ${context.label}`}
    >
      {label ?? `Ask Bailey about this ${CONTEXT_KIND_LABELS[context.kind].toLowerCase()}`}
    </button>
  );
}
