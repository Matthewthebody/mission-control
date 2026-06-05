import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveApiRepoRootFrom } from "../src/utils/repoPaths.js";

const tempRoots: string[] = [];

function makeTempDir() {
  const directory = mkdtempSync(path.join(tmpdir(), "pmc-repo-root-"));
  tempRoots.push(directory);
  return directory;
}

function writeRootMarkers(repoRoot: string) {
  mkdirSync(path.join(repoRoot, "packages", "api"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({
      name: "photographer-mission-control",
      private: true,
      workspaces: ["packages/*", "tools/migrate"]
    })
  );
  writeFileSync(path.join(repoRoot, "package-lock.json"), "{}");
  writeFileSync(path.join(repoRoot, "packages", "api", "package.json"), JSON.stringify({ name: "@pmc/api" }));
}

afterEach(() => {
  for (const directory of tempRoots.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("API repo path resolution", () => {
  it("finds the repository root from a GitHub Actions-style API package path without an ops directory", () => {
    const checkoutRoot = path.join(makeTempDir(), "home", "runner", "work", "mission-control", "mission-control");
    writeRootMarkers(checkoutRoot);
    const apiSourcePath = path.join(checkoutRoot, "packages", "api", "src", "utils");
    mkdirSync(apiSourcePath, { recursive: true });

    expect(resolveApiRepoRootFrom(apiSourcePath)).toBe(path.resolve(checkoutRoot));
  });

  it("finds the repository root from a local nested API package path without an ops directory", () => {
    const checkoutRoot = path.join(makeTempDir(), "Dev", "Codex-integrated-baseline-clean");
    writeRootMarkers(checkoutRoot);
    const apiScriptPath = path.join(checkoutRoot, "packages", "api", "scripts");
    mkdirSync(apiScriptPath, { recursive: true });

    expect(resolveApiRepoRootFrom(apiScriptPath)).toBe(path.resolve(checkoutRoot));
  });

  it("prints checked markers when the repository root cannot be found", () => {
    const startPath = path.join(makeTempDir(), "packages", "api");
    mkdirSync(startPath, { recursive: true });

    expect(() => resolveApiRepoRootFrom(startPath)).toThrow(/Start path:/);
    expect(() => resolveApiRepoRootFrom(startPath)).toThrow(/packages\/api\/package\.json|packages\\api\\package\.json/);
  });
});
