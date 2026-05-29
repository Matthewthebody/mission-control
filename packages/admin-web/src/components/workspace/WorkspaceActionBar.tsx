import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  compact?: boolean;
  align?: "start" | "end";
  className?: string;
};

export function WorkspaceActionBar({ children, compact = false, align = "end", className = "" }: Props) {
  return (
    <div
      className={`workspace-action-bar workspace-action-bar--${align}${compact ? " workspace-action-bar--compact" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      {children}
    </div>
  );
}
