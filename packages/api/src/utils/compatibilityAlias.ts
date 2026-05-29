import type { Response } from "express";

type CompatibilityAliasHeaders = {
  aliasRoute: string;
  canonicalRoute: string;
};

export function applyCompatibilityAliasHeaders(res: Response, input: CompatibilityAliasHeaders) {
  res.setHeader("Deprecation", "true");
  res.setHeader("X-Mission-Control-Compatibility-Alias", input.aliasRoute);
  res.setHeader("X-Mission-Control-Canonical-Route", input.canonicalRoute);
  res.append("Link", `<${input.canonicalRoute}>; rel="successor-version"`);
}
