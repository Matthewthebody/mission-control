type Props = {
  title: string;
  summary: string;
  className?: string;
};

export function WorkspaceLoadingBlock({ title, summary, className = "" }: Props) {
  return (
    <section className={`panel loading-panel workspace-loading-block${className ? ` ${className}` : ""}`}>
      <div className="section-title">{title}</div>
      <p className="section-subtitle">{summary}</p>
    </section>
  );
}
