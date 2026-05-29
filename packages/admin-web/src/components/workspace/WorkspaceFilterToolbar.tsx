import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

export function WorkspaceFilterToolbar({ children, className = "" }: Props) {
  return <section className={`panel workspace-toolbar workspace-filter-toolbar${className ? ` ${className}` : ""}`}>{children}</section>;
}
