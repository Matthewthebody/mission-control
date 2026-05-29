import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_OR_BANNED_TERMS,
  LEGACY_SYNONYM_MAPPINGS,
  LOCKED_GLOSSARY,
  NAMING_RECOMMENDATIONS_BY_LAYER
} from "../src/domain/glossary/index.js";

describe("domain glossary foundation", () => {
  it("keeps canonical terms unique", () => {
    const canonicalTerms = LOCKED_GLOSSARY.map((entry) => entry.canonicalTerm);
    expect(new Set(canonicalTerms).size).toBe(canonicalTerms.length);
  });

  it("keeps ambiguous-term guidance unique", () => {
    const terms = AMBIGUOUS_OR_BANNED_TERMS.map((entry) => entry.term.toLowerCase());
    expect(new Set(terms).size).toBe(terms.length);
  });

  it("maps legacy terms only to canonical glossary entries", () => {
    const canonicalTermSet = new Set(LOCKED_GLOSSARY.map((entry) => entry.canonicalTerm));
    for (const mapping of LEGACY_SYNONYM_MAPPINGS) {
      expect(canonicalTermSet.has(mapping.canonicalTerm)).toBe(true);
    }
  });

  it("defines one naming recommendation per system layer", () => {
    const layers = NAMING_RECOMMENDATIONS_BY_LAYER.map((entry) => entry.systemLayer);
    expect(new Set(layers).size).toBe(layers.length);
  });
});
