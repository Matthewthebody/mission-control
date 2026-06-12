import { useEffect, useId, useRef, useState } from "react";

type Props = {
  /** The explanatory text to reveal. Kept in the DOM for screen readers, hidden until opened. */
  text: string;
  /** Accessible name for the trigger. */
  label?: string;
  className?: string;
};

/**
 * A quiet "?" help icon that reveals an explanatory description on hover (desktop),
 * focus (keyboard), or tap (touch). The description stays in the DOM and is linked
 * with aria-describedby so screen readers always have it; it is only visually shown
 * when open, and is absolutely positioned so it never shifts page layout.
 */
export function HelpTooltip({ text, label = "More information", className = "" }: Props) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const open = hovered || focused || pinned;

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
        type="button"
        className="help-tooltip__trigger"
        aria-label={label}
        aria-describedby={tooltipId}
        aria-expanded={open}
        onClick={() => setPinned((value) => !value)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setPinned(false);
            setFocused(false);
            event.currentTarget.blur();
          }
        }}
      >
        <span aria-hidden="true">?</span>
      </button>
      <span
        role="tooltip"
        id={tooltipId}
        className="help-tooltip__bubble"
        style={{ visibility: open ? "visible" : "hidden", opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
      >
        {text}
      </span>
    </span>
  );
}
