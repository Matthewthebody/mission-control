import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const vitestEntry = "../../node_modules/vitest/vitest.mjs";
const defaultVitestArgs = ["--pool", "forks", "--maxWorkers", "1", "--hookTimeout", "30000"];
const passThroughArgs = process.argv.slice(2);
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

function writeResultOutput(result) {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}

function isRunnerIpcFailure(result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return ipcClosedPatterns.some((pattern) => pattern.test(output));
}

function runVitestOnce(args) {
  const result = spawnSync(
    process.execPath,
    ["--import", "./scripts/vitest-bootstrap.mjs", vitestEntry, "run", ...args, ...defaultVitestArgs],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    }
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
  if (result.status === 0) {
    return 0;
  }
  if (!isRunnerIpcFailure(result)) {
    return result.status;
  }

  console.warn(`[api-tests] Vitest runner IPC channel closed while running ${args.join(" ")}. Retrying this file once.`);
  const retry = runVitestOnce(args);
  writeResultOutput(retry);
  if (retry.status !== 0 && isRunnerIpcFailure(retry)) {
    console.error(`[api-tests] Vitest runner IPC channel closed again for ${args.join(" ")}.`);
  }
  return retry.status;
}

if (passThroughArgs.length > 0) {
  process.exit(runVitest(passThroughArgs));
}

const testDir = join(process.cwd(), "tests");
if (!statSync(testDir).isDirectory()) {
  console.error("Could not find API tests directory.");
  process.exit(1);
}

const files = collectTestFiles(testDir).sort();
const chunks = chunk(files, 1);

for (let index = 0; index < chunks.length; index += 1) {
  console.log(`\n[api-tests] Running file ${index + 1}/${chunks.length}: ${chunks[index][0]}\n`);
  const status = runVitest(chunks[index]);
  if (status !== 0) {
    process.exit(status);
  }
}
