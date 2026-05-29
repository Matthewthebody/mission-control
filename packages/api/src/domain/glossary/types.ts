export const GLOSSARY_CATEGORY_REGISTRY = ["core_object", "actor", "state_concept"] as const;

export type GlossaryCategory = (typeof GLOSSARY_CATEGORY_REGISTRY)[number];

export const GLOSSARY_SYSTEM_LAYER_REGISTRY = [
  "database_schema",
  "backend_types",
  "api_contracts",
  "frontend_ui",
  "filters_and_dashboards",
  "audit_logs",
  "permissions",
  "alerts_and_notifications",
  "integrations",
  "prompts_and_docs"
] as const;

export type GlossarySystemLayer = (typeof GLOSSARY_SYSTEM_LAYER_REGISTRY)[number];

export interface GlossaryEntry {
  canonicalTerm: string;
  category: GlossaryCategory;
  plainEnglishDefinition: string;
  usedIn: readonly GlossarySystemLayer[];
  whatItIsNot: string;
  allowedSynonyms: readonly string[];
  discouragedSynonyms: readonly string[];
}

export interface AmbiguousTermRule {
  term: string;
  status: "discouraged" | "banned";
  why: string;
  useInstead: readonly string[];
}

export interface LayerNamingRecommendation {
  systemLayer: GlossarySystemLayer;
  recommendation: string;
  preferredPattern: string;
  examples: readonly string[];
  avoid: readonly string[];
}

export interface LegacySynonymMapping {
  legacyTerm: string;
  canonicalTerm: string;
  guidance: string;
}
