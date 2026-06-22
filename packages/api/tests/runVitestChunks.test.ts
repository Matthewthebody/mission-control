import { describe, expect, it } from "vitest";
// Self-test for the API chunk runner's PURE helpers. Importing the runner must have no side effects
// (main() is guarded), so these are safe to exercise here.
import { resolveFailFast, summarize } from "../scripts/run-vitest-chunks.mjs";

describe("api test-runner hardening", () => {
  it("fail-fast is configurable and defaults to OFF (run everything — never hide tail files)", () => {
    expect(resolveFailFast([], {})).toBe(false);
    expect(resolveFailFast(["--fail-fast"], {})).toBe(true);
    expect(resolveFailFast([], { API_TESTS_FAIL_FAST: "1" })).toBe(true);
    expect(resolveFailFast([], { API_TESTS_FAIL_FAST: "true" })).toBe(true);
    // an explicit --no-fail-fast wins over the env toggle
    expect(resolveFailFast(["--no-fail-fast"], { API_TESTS_FAIL_FAST: "1" })).toBe(false);
  });

  it("summarize: all green → exit 0 and a greppable PASS line", () => {
    const s = summarize([{ file: "a.test.ts", status: 0 }, { file: "b.test.ts", status: 0 }], []);
    expect(s.exitCode).toBe(0);
    expect(s.failedFiles).toEqual([]);
    expect(s.report).toContain("[api-tests] RESULT: PASS");
    expect(s.report).toContain("passed=2  failed=0  skipped=0");
  });

  it("summarize: any failing file → exit 1, the file is listed, and the result is FAIL", () => {
    const s = summarize([{ file: "a.test.ts", status: 0 }, { file: "bad.test.ts", status: 1 }], []);
    expect(s.exitCode).toBe(1);
    expect(s.failedFiles).toEqual(["bad.test.ts"]);
    expect(s.report).toContain("[api-tests] RESULT: FAIL");
    expect(s.report).toContain("bad.test.ts");
  });

  it("summarize: skipped tail files are explicit and force a non-zero exit (a skip is never a silent pass)", () => {
    const s = summarize([{ file: "a.test.ts", status: 0 }], ["c.test.ts", "d.test.ts"]);
    expect(s.exitCode).toBe(1); // even though nothing FAILED, unknown skipped files are not a pass
    expect(s.skippedFiles).toEqual(["c.test.ts", "d.test.ts"]);
    expect(s.report).toContain("SKIPPED (did not run");
    expect(s.report).toContain("[api-tests] RESULT: FAIL");
  });
});
