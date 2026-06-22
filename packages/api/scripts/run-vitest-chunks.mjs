import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const vitestEntry = "../../node_modules/vitest/vitest.mjs";
const defaultVitestArgs = ["--pool", "forks", "--maxWorkers", "1", "--hookTimeout", "30000"];
const ipcClosedPatterns = [/ERR_IPC_CHANNEL_CLOSED/i, /Channel closed/i];

function collectTestFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }
    if (/\.test\.[cm]?[tj]sx?$/.test(entry.name)) {
      files.push(relative(process.cwd(), fullPath).replace(/\\/g, "/"));
    }
  }
  return files;
}

function chunk(files, size) {
  const chunks = [];
  for (let index = 0; index < files.length; index += size) {
    chunks.push(files.slice(index, index + size));
  }
  return chunks;
}

// Fail-fast is CONFIGURABLE. Default is run-everything (non-fail-fast) so a single failing file can
// never hide the rest — the historical defect was `process.exit` on the first failure, which silently
// skipped every later file. Opt into fail-fast with `--fail-fast` or `API_TESTS_FAIL_FAST=1`.
export function resolveFailFast(argv = [], env = {}) {
  if (argv.includes("--no-fail-fast")) return false;
  if (argv.includes("--fail-fast")) return true;
  if (env.API_TESTS_FAIL_FAST === "1" || env.API_TESTS_FAIL_FAST === "true") return true;
  return false;
}

// Pure, testable summary of a completed run. `results` is [{ file, status }]; `skipped` is the list of
// files that never ran (fail-fast stopped early). Exit code is non-zero if ANY file failed OR any file
// was skipped (a skipped file is an unknown, never a silent pass).
export function summarize(results, skipped = []) {
  const passedFiles = results.filter((r) => r.status === 0).map((r) => r.file);
  const failedFiles = results.filter((r) => r.status !== 0).map((r) => r.file);
  const ok = failedFiles.length === 0 && skipped.length === 0;
  const lines = [];
  lines.push("");
  lines.push("──────────────────────────────────────────────────────────────");
  lines.push(`[api-tests] SUMMARY  passed=${passedFiles.length}  failed=${failedFiles.length}  skipped=${skipped.length}`);
  if (failedFiles.length) lines.push(`[api-tests] FAILED FILES:\n  - ${failedFiles.join("\n  - ")}`);
  if (skipped.length) lines.push(`[api-tests] SKIPPED (did not run — fail-fast stopped early):\n  - ${skipped.join("\n  - ")}`);
  // A single greppable result line so a trailing shell pipe can never mask the true outcome.
  lines.push(`[api-tests] RESULT: ${ok ? "PASS" : "FAIL"}`);
  lines.push("──────────────────────────────────────────────────────────────");
  return { passedFiles, failedFiles, skippedFiles: skipped, exitCode: ok ? 0 : 1, report: lines.join("\n") };
}

function writeResultOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function isRunnerIpcFailure(result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return ipcClosedPatterns.some((pattern) => pattern.test(output));
}

function runVitestOnce(args) {
  const result = spawnSync(
    process.execPath,
    ["--import", "./scripts/vitest-bootstrap.mjs", vitestEntry, "run", ...args, ...defaultVitestArgs],
    { cwd: process.cwd(), env: process.env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true }
  );
  if (result.error) {
    console.error(result.error);
    return { status: 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function runVitest(args) {
  const result = runVitestOnce(args);
  writeResultOutput(result);
  if (result.status === 0) return 0;
  if (!isRunnerIpcFailure(result)) return result.status;
  console.warn(`[api-tests] Vitest runner IPC channel closed while running ${args.join(" ")}. Retrying this file once.`);
  const retry = runVitestOnce(args);
  writeResultOutput(retry);
  if (retry.status !== 0 && isRunnerIpcFailure(retry)) {
    console.error(`[api-tests] Vitest runner IPC channel closed again for ${args.join(" ")}.`);
  }
  return retry.status;
}

function main() {
  const argv = process.argv.slice(2);
  // explicit file/pattern args → delegate to a single vitest run (vitest reports its own status).
  const passThroughArgs = argv.filter((a) => a !== "--fail-fast" && a !== "--no-fail-fast");
  if (passThroughArgs.length > 0) {
    process.exit(runVitest(passThroughArgs));
  }

  const testDir = join(process.cwd(), "tests");
  if (!statSync(testDir).isDirectory()) {
    console.error("Could not find API tests directory.");
    process.exit(1);
  }

  const failFast = resolveFailFast(argv, process.env);
  const files = collectTestFiles(testDir).sort();
  const chunks = chunk(files, 1);
  const results = [];
  const skipped = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const file = chunks[index][0];
    console.log(`\n[api-tests] Running file ${index + 1}/${chunks.length}: ${file}\n`);
    const status = runVitest(chunks[index]);
    results.push({ file, status });
    if (status !== 0 && failFast) {
      // record the tail we are NOT running so the skip is explicit, never silent.
      for (let j = index + 1; j < chunks.length; j += 1) skipped.push(chunks[j][0]);
      break;
    }
  }

  const { report, exitCode } = summarize(results, skipped);
  process.stdout.write(`${report}\n`);
  process.exit(exitCode);
}

// Only run when invoked directly — importing this module (e.g. from a self-test) must have no side effects.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
