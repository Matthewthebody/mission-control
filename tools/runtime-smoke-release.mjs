import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getGitWorktreeState, writeRuntimeSmokeAttestation } from "./release-discipline-state.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(repoRoot, "packages", "api");
const workerDir = path.join(repoRoot, "packages", "worker");
const apiEntry = path.join(apiDir, "dist", "src", "server.js");
const workerEntry = path.join(workerDir, "dist", "src", "index.js");
const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
const adminWebDir = path.join(repoRoot, "packages", "admin-web");

const apiPort = Number(process.env.RELEASE_RUNTIME_API_PORT ?? 4400);
const webPort = Number(process.env.RELEASE_RUNTIME_WEB_PORT ?? 4273);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const webBaseUrl = `http://127.0.0.1:${webPort}`;

const children = [];

function startProcess(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });

  const state = {
    name,
    child,
    stdout: "",
    stderr: ""
  };
  children.push(state);

  child.stdout?.on("data", (chunk) => {
    const text = chunk.toString();
    state.stdout += text;
    process.stdout.write(`[${name}] ${text}`);
  });

  child.stderr?.on("data", (chunk) => {
    const text = chunk.toString();
    state.stderr += text;
    process.stderr.write(`[${name}] ${text}`);
  });

  child.on("exit", (code, signal) => {
    if (code !== null || signal !== null) {
      process.stdout.write(`[${name}] exited (${code ?? "signal"}${signal ? ` / ${signal}` : ""})\n`);
    }
  });

  return state;
}

async function waitFor(fn, { timeoutMs, intervalMs = 500, label }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await fn();
      if (value) {
        return value;
      }
    } catch {
      // Keep polling until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, json, text };
}

async function validateApiHealth() {
  const { response, json } = await fetchJson(`${apiBaseUrl}/health`);
  if (!response.ok || !json?.ok) {
    return null;
  }
  return json;
}

async function validateWebPreview() {
  const response = await fetch(webBaseUrl);
  const text = await response.text();
  if (!response.ok || !text.includes("<!doctype html>")) {
    return null;
  }
  return true;
}

async function waitForWorkerReady(workerState) {
  return waitFor(
    async () => {
      if (workerState.child.exitCode !== null) {
        throw new Error("Worker exited before becoming ready.");
      }
      return workerState.stdout.includes("Worker running") ? true : null;
    },
    {
      timeoutMs: 20000,
      label: "worker startup"
    }
  );
}

async function loginAsSeededOwner() {
  const { response, json, text } = await fetchJson(`${apiBaseUrl}/auth/dev-login`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ email: "matthew@example.com" })
  });

  if (!response.ok || !json?.token) {
    throw new Error(`Runtime auth failed (${response.status}): ${text}`);
  }

  return json.token;
}

async function validateAuthenticatedRoutes(token) {
  const headers = {
    authorization: `Bearer ${token}`
  };

  const endpointChecks = [];

  const session = await fetchJson(`${apiBaseUrl}/auth/me`, { headers });
  endpointChecks.push({ route_path: "/auth/me", ok: session.response.ok && session.json?.user?.email === "matthew@example.com", status: session.response.status });
  if (!session.response.ok || session.json?.user?.email !== "matthew@example.com") {
    throw new Error(`Runtime auth session check failed (${session.response.status}).`);
  }

  const exceptions = await fetchJson(`${apiBaseUrl}/api/exceptions`, { headers });
  endpointChecks.push({ route_path: "/api/exceptions", ok: exceptions.response.ok && Boolean(exceptions.json), status: exceptions.response.status });
  if (!exceptions.response.ok || !exceptions.json) {
    throw new Error(`Runtime exceptions read failed (${exceptions.response.status}).`);
  }

  const ownerCommand = await fetchJson(
    `${apiBaseUrl}/api/dashboard/owner-command?date=${encodeURIComponent(new Date().toISOString().slice(0, 10))}`,
    { headers }
  );
  endpointChecks.push({
    route_path: "/api/dashboard/owner-command",
    ok: ownerCommand.response.ok && Boolean(ownerCommand.json?.summary),
    status: ownerCommand.response.status
  });
  if (!ownerCommand.response.ok || !ownerCommand.json?.summary) {
    throw new Error(`Runtime owner-command read failed (${ownerCommand.response.status}).`);
  }

  return endpointChecks;
}

async function main() {
  const endpointChecks = [{ route_path: "/health", ok: false, status: null }];
  const apiState = startProcess("api", process.execPath, [apiEntry], {
    cwd: apiDir,
    env: {
      ...process.env,
      API_PORT: String(apiPort),
      API_PUBLIC_URL: apiBaseUrl,
      ADMIN_WEB_URL: webBaseUrl,
      SOCKET_IO_CORS_ORIGIN: webBaseUrl
    }
  });

  const workerState = startProcess("worker", process.execPath, [workerEntry], {
    cwd: workerDir,
    env: process.env
  });

  const webState = startProcess("web", process.execPath, [viteBin, "preview", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], {
    cwd: adminWebDir,
    env: process.env
  });

  const apiHealth = await waitFor(validateApiHealth, { timeoutMs: 30000, label: "API /health" });
  endpointChecks[0] = { route_path: "/health", ok: Boolean(apiHealth?.ok), status: 200 };
  await waitFor(validateWebPreview, { timeoutMs: 30000, label: "admin-web preview" });
  await waitForWorkerReady(workerState);

  const token = await loginAsSeededOwner();
  endpointChecks.push(...(await validateAuthenticatedRoutes(token)));

  if (apiState.child.exitCode !== null) {
    throw new Error("API process exited during runtime smoke.");
  }
  if (workerState.child.exitCode !== null) {
    throw new Error("Worker process exited during runtime smoke.");
  }
  if (webState.child.exitCode !== null) {
    throw new Error("Admin-web preview exited during runtime smoke.");
  }

  const git = getGitWorktreeState(repoRoot);
  writeRuntimeSmokeAttestation({
    passed: true,
    attested_at: new Date().toISOString(),
    branch: git.branch,
    commit_sha: git.head_sha,
    core_endpoints: endpointChecks,
    error: null
  }, repoRoot);

  console.log("Release runtime smoke passed.");
}

function shutdown() {
  for (const { child } of children) {
    if (child.exitCode === null) {
      child.kill();
    }
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(1);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(1);
});

main()
  .catch((error) => {
    const git = getGitWorktreeState(repoRoot);
    writeRuntimeSmokeAttestation({
      passed: false,
      attested_at: new Date().toISOString(),
      branch: git.branch,
      commit_sha: git.head_sha,
      core_endpoints: [],
      error: error instanceof Error ? error.message : String(error)
    }, repoRoot);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    shutdown();
  });
