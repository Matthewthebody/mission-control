import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cachedRepoRoot: string | null = null;

type MarkerStatus = {
  workspacePackageJson: boolean;
  packageLock: boolean;
  workerPackageJson: boolean;
};

function hasWorkspacePackageJson(candidate: string) {
  const packageJsonPath = path.join(candidate, "package.json");
  if (!existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { workspaces?: unknown };
    return Array.isArray(parsed.workspaces) && parsed.workspaces.includes("packages/*") && parsed.workspaces.includes("tools/migrate");
  } catch {
    return false;
  }
}

function getMarkerStatus(candidate: string): MarkerStatus {
  return {
    workspacePackageJson: hasWorkspacePackageJson(candidate),
    packageLock: existsSync(path.join(candidate, "package-lock.json")),
    workerPackageJson: existsSync(path.join(candidate, "packages", "worker", "package.json"))
  };
}

function isRepoRoot(candidate: string) {
  const markers = getMarkerStatus(candidate);
  return markers.workspacePackageJson && markers.packageLock && markers.workerPackageJson;
}

function formatMarkerStatus(markers: MarkerStatus) {
  return [
    `workspace package.json=${markers.workspacePackageJson ? "yes" : "no"}`,
    `package-lock.json=${markers.packageLock ? "yes" : "no"}`,
    `packages/worker/package.json=${markers.workerPackageJson ? "yes" : "no"}`
  ].join(", ");
}

export function resolveWorkerRepoRootFrom(startPath: string) {
  const checkedCandidates: string[] = [];
  let current = path.resolve(startPath);

  while (true) {
    const markers = getMarkerStatus(current);
    checkedCandidates.push(`${current} (${formatMarkerStatus(markers)})`);

    if (isRepoRoot(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        [
          "Unable to locate the repository root from the worker package.",
          `Start path: ${path.resolve(startPath)}`,
          "Checked candidates:",
          ...checkedCandidates.map((candidate) => `- ${candidate}`)
        ].join("\n")
      );
    }
    current = parent;
  }
}

export function resolveWorkerRepoRoot() {
  if (cachedRepoRoot) {
    return cachedRepoRoot;
  }

  cachedRepoRoot = resolveWorkerRepoRootFrom(path.dirname(fileURLToPath(import.meta.url)));
  return cachedRepoRoot;
}

export function resolveWorkerRepoPath(...segments: string[]) {
  return path.join(resolveWorkerRepoRoot(), ...segments);
}
