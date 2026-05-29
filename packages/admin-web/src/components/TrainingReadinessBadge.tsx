import type { TrainingReadinessState } from "../types";

type Props = {
  state: TrainingReadinessState;
  compact?: boolean;
};

export function TrainingReadinessBadge({ state, compact = false }: Props) {
  return (
    <span className={`badge-pill training-readiness-badge training-readiness-badge--${state}${compact ? " training-readiness-badge--compact" : ""}`}>
      {getReadinessLabel(state)}
    </span>
  );
}

export function getReadinessLabel(state: TrainingReadinessState) {
  switch (state) {
    case "cleared":
      return "Cleared";
    case "cleared_with_oversight":
      return "Cleared With Oversight";
    case "retraining_required":
      return "Retraining Required";
    default:
      return "Not Cleared";
  }
}
