import { useEffect, useId, useRef, useState } from "react";

type Props = {
  /** The explanatory text to reveal. Kept in the DOM for screen readers, hidden until opened. */
  text: string;
  /** Accessible name for the trigger, e.g. "Help: Job Snapshot". */
  label?: string;
  className?: string;
};

/**
 * The single standardized Help control for Mission Control. A quiet "?" button that reveals an
 * explanatory description ONLY when the user asks for it — by click or keyboard (Enter/Space toggles
 * the native button). A brief hover preview is offered as a convenience but is never the only way in.
 *
 * Accessibility contract (see HelpTooltip.test.tsx):
 *  - hidden by default; opens on click/keyboard, not hover-only
 *  - Escape closes it AND leaves focus on the trigger button (focus is never lost to the body)
 *  - clicking outside closes it
 *  - the description is always in the DOM and linked via aria-describedby for screen readers
 *  - long content scrolls inside the popover (max-height + overflow), never shifting page layout
 *  - status/colour is never the only signal — the trigger has a real accessible name
 */
export function HelpTooltip({ text, label = "More information", className = "" }: Props) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipId = useId();
  const open = hovered || pinned;

  useEffect(() => {
    if (!pinned) {
      return;
    }
    function onDocMouseDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setPinned(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [pinned]);

  return (
    <span ref={wrapRef} className={`help-tooltip${className ? ` ${className}` : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="help-tooltip__trigger"
        aria-label={label}
        aria-describedby={tooltipId}
        aria-expanded={open}
        // Click / Enter / Space toggle the disclosure (native button semantics give us keyboard open).
        onClick={() => setPinned((value) => !value)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && (pinned || hovered)) {
            // Close, but KEEP focus on the trigger so keyboard users are never stranded.
            event.preventDefault();
            event.stopPropagation();
            setPinned(false);
            setHovered(false);
            triggerRef.current?.focus();
          }
        }}
      >
        <span aria-hidden="true">?</span>
      </button>
      <span
        role="tooltip"
        id={tooltipId}
        className="help-tooltip__bubble"
        style={{
          visibility: open ? "visible" : "hidden",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          maxHeight: "16rem",
          overflowY: "auto"
        }}
      >
        {text}
      </span>
    </span>
  );
}
