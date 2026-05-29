export const SCOPE_REGISTRY = [
  "global",
  "department",
  "organization",
  "location",
  "shoot",
  "self",
  "assigned_shoot",
  "owned_record"
] as const;

export type Scope = (typeof SCOPE_REGISTRY)[number];

const SCOPE_SET = new Set<string>(SCOPE_REGISTRY);

export function isScope(value: string): value is Scope {
  return SCOPE_SET.has(value);
}
