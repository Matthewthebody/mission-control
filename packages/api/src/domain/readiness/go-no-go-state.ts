export const GO_NO_GO_STATE_REGISTRY = ["hold", "go", "no_go"] as const;

export type GoNoGoState = (typeof GO_NO_GO_STATE_REGISTRY)[number];

const GO_NO_GO_STATE_SET = new Set<string>(GO_NO_GO_STATE_REGISTRY);

export function isGoNoGoState(value: string): value is GoNoGoState {
  return GO_NO_GO_STATE_SET.has(value);
}
