import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cachedRepoRoot: string | null = null;

function isRepoRoot(candidate: string) {
  return existsSync(path.join(candidate, "package.json")) && existsSync(path.join(candidate, "packages")) && existsSync(path.join(candidate, "ops"));
}

export function resolveApiRepoRoot() {
  if (cachedRepoRoot) {
    return cachedRepoRoot;
  }

  let current = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (isRepoRoot(current)) {
      cachedRepoRoot = current;
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Unable to locate the repository root from the API package.");
    }
    current = parent;
  }
}

export function resolveApiRepoPath(...segments: string[]) {
  return path.join(resolveApiRepoRoot(), ...segments);
}
