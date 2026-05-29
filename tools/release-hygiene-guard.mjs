import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];

const artifactPatterns = [
  /^packages\/[^/]+\/vitest-.*\.json$/i,
  /^tmp-.*\.txt$/i,
  /^%SystemDrive%\//i
];

const largeTempPatterns = [/^tmp-/i, /^%SystemDrive%\//i];
const maxTempBytes = 256 * 1024;

function runGit(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function listGitPaths(args) {
  const output = runGit(args);
  return output
    ? output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
}

function isArtifactPath(relativePath) {
  return artifactPatterns.some((pattern) => pattern.test(relativePath));
}

function isLargeTempPath(relativePath) {
  return largeTempPatterns.some((pattern) => pattern.test(relativePath));
}

function collectPreCommitViolations() {
  const stagedPaths = listGitPaths(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  const untrackedPaths = listGitPaths(["ls-files", "--others", "--exclude-standard"]);
  const violations = [];

  for (const relativePath of [...stagedPaths, ...untrackedPaths]) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (isArtifactPath(relativePath)) {
      violations.push({
        kind: "artifact",
        relativePath
      });
      continue;
    }

    if (isLargeTempPath(relativePath) && fs.existsSync(absolutePath)) {
      const size = fs.statSync(absolutePath).size;
      if (size > maxTempBytes) {
        violations.push({
          kind: "large-temp",
          relativePath,
          size
        });
      }
    }
  }

  return violations;
}

function runPreCommit() {
  const violations = collectPreCommitViolations();
  if (violations.length === 0) {
    process.exit(0);
  }

  console.error("Release hygiene guard blocked the commit.");
  console.error("Remove generated artifacts or temporary files before committing:");
  for (const violation of violations) {
    if (violation.kind === "large-temp") {
      console.error(`- ${violation.relativePath} (${violation.size} bytes)`);
      continue;
    }
    console.error(`- ${violation.relativePath}`);
  }
  process.exit(1);
}

function runPrePush() {
  const result = spawnSync("npm", ["run", "verify:release:clean"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  process.exit(result.status ?? 1);
}

switch (mode) {
  case "pre-commit":
    runPreCommit();
    break;
  case "pre-push":
    runPrePush();
    break;
  default:
    console.error("Usage: node tools/release-hygiene-guard.mjs <pre-commit|pre-push>");
    process.exit(1);
}
