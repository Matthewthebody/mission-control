export const ACTION_REGISTRY = [
  "view",
  "create",
  "edit",
  "delete",
  "submit",
  "publish",
  "assign",
  "remove",
  "evaluate",
  "transition",
  "approve",
  "deny",
  "override",
  "clock",
  "upload",
  "export",
  "sync",
  "receive_notification"
] as const;

export type Action = (typeof ACTION_REGISTRY)[number];

const ACTION_SET = new Set<string>(ACTION_REGISTRY);

export function isAction(value: string): value is Action {
  return ACTION_SET.has(value);
}
