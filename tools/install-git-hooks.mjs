import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tryRunGit(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

try {
  const gitRoot = tryRunGit(["rev-parse", "--show-toplevel"]);
  if (path.resolve(gitRoot) !== repoRoot) {
    console.warn(`Skipping git hook install because repo root mismatch: ${gitRoot}`);
    process.exit(0);
  }

  tryRunGit(["config", "core.hooksPath", ".githooks"]);
  console.log("Configured local git hooks path to .githooks");
} catch (error) {
  console.warn("Skipping git hook install.");
  console.warn(error instanceof Error ? error.message : String(error));
}
