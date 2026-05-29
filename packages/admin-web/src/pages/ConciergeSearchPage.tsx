import { useMemo } from "react";
import { ConciergeCommandPalette } from "../components/concierge/ConciergeCommandPalette";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { useHashRouteSnapshot } from "../components/sports/SportsPrimitives";

type Props = {
  token: string;
};

function parseInitialQuery(hash: string) {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  const [, queryString = ""] = normalized.split("?");
  const params = new URLSearchParams(queryString);
  return params.get("q")?.trim() ?? "";
}

export function ConciergeSearchPage({ token }: Props) {
  const { hash } = useHashRouteSnapshot();
  const initialQuery = useMemo(() => parseInitialQuery(hash), [hash]);

  return (
    <section className="concierge-page">
      <WorkspacePageHeader
        eyebrow="Kemmetmueller Concierge"
        title="Operational Search"
        summary="Search directory records, work, notes, staffing context, exceptions, and post-shoot evaluations from one command center."
        meta={[
          { label: "Permission aware", tone: "info" },
          { label: "Saved searches", tone: "success" },
          { label: "Typed filters", tone: "warning" },
          { label: "Cmd/Ctrl + K", tone: "neutral" }
        ]}
        compact
      />
      <ConciergeCommandPalette token={token} open mode="page" mobile={false} initialQuery={initialQuery} />
    </section>
  );
}
