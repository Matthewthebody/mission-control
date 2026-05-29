import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeSmokeAttestationPath = path.join(repoRoot, ".codex-artifacts", "release-runtime-smoke.json");
const coreEndpointPaths = ["/health", "/auth/me", "/api/exceptions", "/api/dashboard/owner-command"];

function booleanEnv(value) {
  return value === "true";
}

function runGit(args, targetRepoRoot = repoRoot) {
  return execFileSync("git", args, {
    cwd: targetRepoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

export function getRuntimeSmokeAttestationPath(targetRepoRoot = repoRoot) {
  return path.join(targetRepoRoot, ".codex-artifacts", "release-runtime-smoke.json");
}

export function getGitWorktreeState(targetRepoRoot = repoRoot) {
  const checkedAt = new Date().toISOString();
  try {
    const branch = runGit(["branch", "--show-current"], targetRepoRoot);
    const headSha = runGit(["rev-parse", "HEAD"], targetRepoRoot);
    const status = runGit(["status", "--porcelain=v1", "--untracked-files=normal"], targetRepoRoot);
    const dirtyPaths = status
      ? status
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      : [];

    return {
      checked_at: checkedAt,
      branch,
      head_sha: headSha,
      is_clean: dirtyPaths.length === 0,
      dirty_path_count: dirtyPaths.length,
      dirty_paths: dirtyPaths,
      error: null
    };
  } catch (error) {
    return {
      checked_at: checkedAt,
      branch: null,
      head_sha: null,
      is_clean: false,
      dirty_path_count: 0,
      dirty_paths: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function readRuntimeSmokeAttestation(targetRepoRoot = repoRoot) {
  const attestationFile = getRuntimeSmokeAttestationPath(targetRepoRoot);
  if (!fs.existsSync(attestationFile)) {
    return {
      path: attestationFile,
      exists: false,
      passed: false,
      attested_at: null,
      commit_sha: null,
      core_endpoints_ok: false,
      core_endpoints: coreEndpointPaths.map((route_path) => ({
        route_path,
        ok: false,
        status: null
      })),
      error: "Runtime smoke attestation file is missing."
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(attestationFile, "utf8"));
    const coreEndpoints = Array.isArray(parsed?.core_endpoints)
      ? parsed.core_endpoints.map((entry) => ({
          route_path: String(entry?.route_path ?? ""),
          ok: Boolean(entry?.ok),
          status: typeof entry?.status === "number" ? entry.status : null
        }))
      : [];
    const endpointMap = new Map(coreEndpoints.map((entry) => [entry.route_path, entry]));
    const normalizedCoreEndpoints = coreEndpointPaths.map((route_path) => {
      const existing = endpointMap.get(route_path);
      return existing ?? { route_path, ok: false, status: null };
    });
    const coreEndpointsOk = normalizedCoreEndpoints.every((entry) => entry.ok);

    return {
      path: attestationFile,
      exists: true,
      passed: Boolean(parsed?.passed),
      attested_at: typeof parsed?.attested_at === "string" ? parsed.attested_at : null,
      commit_sha: typeof parsed?.commit_sha === "string" ? parsed.commit_sha : null,
      core_endpoints_ok: coreEndpointsOk,
      core_endpoints: normalizedCoreEndpoints,
      error: typeof parsed?.error === "string" ? parsed.error : null
    };
  } catch (error) {
    return {
      path: attestationFile,
      exists: true,
      passed: false,
      attested_at: null,
      commit_sha: null,
      core_endpoints_ok: false,
      core_endpoints: coreEndpointPaths.map((route_path) => ({
        route_path,
        ok: false,
        status: null
      })),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function evaluateReleaseDiscipline(targetRepoRoot = repoRoot, env = process.env) {
  const git = getGitWorktreeState(targetRepoRoot);
  const runtime_smoke = readRuntimeSmokeAttestation(targetRepoRoot);
  const commitMatches = Boolean(git.head_sha && runtime_smoke.commit_sha && git.head_sha === runtime_smoke.commit_sha);

  const blockers = [];
  if (!git.is_clean) {
    blockers.push("git_worktree_dirty");
  }
  if (!runtime_smoke.exists) {
    blockers.push("runtime_smoke_missing");
  } else if (!runtime_smoke.passed) {
    blockers.push("runtime_smoke_failed");
  }
  if (!runtime_smoke.core_endpoints_ok) {
    blockers.push("core_api_endpoints_failed");
  }
  if (runtime_smoke.exists && runtime_smoke.passed && !commitMatches) {
    blockers.push("runtime_smoke_commit_mismatch");
  }

  const releaseReady = blockers.length === 0;
  const pilotModeEnabled = booleanEnv(env.PILOT_MODE_ENABLED);

  return {
    generated_at: new Date().toISOString(),
    git,
    runtime_smoke: {
      ...runtime_smoke,
      commit_matches_head: commitMatches
    },
    pilot_mode: {
      enabled: pilotModeEnabled,
      eligible: releaseReady,
      blockers
    },
    release_ready: releaseReady
  };
}

export function writeRuntimeSmokeAttestation(attestation, targetRepoRoot = repoRoot) {
  const attestationFile = getRuntimeSmokeAttestationPath(targetRepoRoot);
  fs.mkdirSync(path.dirname(attestationFile), { recursive: true });
  fs.writeFileSync(attestationFile, JSON.stringify(attestation, null, 2));
  return attestationFile;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(evaluateReleaseDiscipline(), null, 2));
}
