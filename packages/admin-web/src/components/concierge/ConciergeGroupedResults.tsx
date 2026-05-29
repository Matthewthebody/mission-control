import type { ConciergeSearchResponse, ConciergeSearchResult } from "../../conciergeTypes";
import { ConciergeResultRow } from "./ConciergeResultRow";

type Props = {
  response: ConciergeSearchResponse | null;
  activeResultId: string | null;
  onOpen: (result: ConciergeSearchResult) => void;
  onActivate: (result: ConciergeSearchResult) => void;
};

export function ConciergeGroupedResults({ response, activeResultId, onOpen, onActivate }: Props) {
  if (!response) {
    return null;
  }

  return (
    <>
      {response.sections.map((section) => (
        <div key={section.entity_type} className="concierge-result-group" role="group" aria-label={section.title}>
          <div className="concierge-result-group__header">
            <strong>{section.title}</strong>
            <span>{section.total}</span>
          </div>
          <div className="concierge-result-group__rows">
            {section.results.map((result) => (
              <ConciergeResultRow
                key={result.search_index_id}
                result={result}
                active={activeResultId === result.search_index_id}
                onOpen={onOpen}
                onActivate={onActivate}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
