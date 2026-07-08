import { describe, expect, it } from "vitest";
import { parseSharedJobIdFromParams, parseSharedJobIdFromPath } from "../components/jobs/sharedJobRouting";

// Regression for GET /api/jobs/detail -> 500: the canonical "#…/jobs/detail" hash segment must never
// be treated as a job id; on those hashes the id travels in the query string instead.
describe("parseSharedJobIdFromPath", () => {
  it("parses a path-segment job id", () => {
    expect(parseSharedJobIdFromPath("schools/jobs/abc-123")).toBe("abc-123");
  });

  it("parses the id for edit routes", () => {
    expect(parseSharedJobIdFromPath("schools/jobs/abc-123/edit")).toBe("abc-123");
  });

  it("returns null for the canonical detail segment — never the literal 'detail'", () => {
    expect(parseSharedJobIdFromPath("schools/jobs/detail")).toBeNull();
    expect(parseSharedJobIdFromPath("sports/jobs/detail")).toBeNull();
    expect(parseSharedJobIdFromPath("jobs/detail")).toBeNull();
  });

  it("returns null for list/new segments", () => {
    expect(parseSharedJobIdFromPath("schools/jobs")).toBeNull();
    expect(parseSharedJobIdFromPath("schools/jobs/new")).toBeNull();
  });
});

describe("parseSharedJobIdFromParams", () => {
  it("reads ?job= deep-links", () => {
    expect(parseSharedJobIdFromParams(new URLSearchParams("job=abc-123"))).toBe("abc-123");
  });

  it("reads ?preview= links from the production workflow queue", () => {
    expect(parseSharedJobIdFromParams(new URLSearchParams("preview=abc-123"))).toBe("abc-123");
  });

  it("returns null when no id param is present", () => {
    expect(parseSharedJobIdFromParams(new URLSearchParams("tab=day-of"))).toBeNull();
  });
});
