import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";
import { resolveApiRepoPath, resolveApiRepoRoot } from "../src/utils/repoPaths.js";

const CONFIRM_FLAG = "--yes-reset-local-demo-db";
const SAFE_LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const SAFE_DATABASE_NAMES = new Set(["pmc", "pmc_dev", "pmc_demo", "pmc_local", "pmc_test"]);
const UNSAFE_NAME_PARTS = /\b(prod|production|stage|staging|shared|real|customer|client)\b/i;
const SAFE_LOCAL_DATABASE_USERS = new Set(["postgres", "pmc", "pmc_local", "pmc_demo"]);

type ResetTarget = {
  databaseName: string;
  displayHost: string;
  maintenanceUrl: string;
};

export function isSafeLocalDatabaseName(databaseName: string) {
  if (!databaseName || UNSAFE_NAME_PARTS.test(databaseName)) {
    return false;
  }
  if (SAFE_DATABASE_NAMES.has(databaseName)) {
    return true;
  }
  return /^(pmc|mission_control)_(dev|demo|local|test)(?:_[a-z0-9_]+)?$/i.test(databaseName);
}

export function inspectLocalDemoResetTarget(input: { dbUrl?: string; nodeEnv?: string; argv?: string[] }): ResetTarget {
  const argv = input.argv ?? process.argv;
  if (!argv.includes(CONFIRM_FLAG)) {
    throw new Error(`Refusing to reset without ${CONFIRM_FLAG}. Use npm run db:reset:demo so the intent is explicit.`);
  }

  const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV ?? "development";
  if (nodeEnv === "production") {
    throw new Error("Refusing to reset a database while NODE_ENV=production.");
  }

  if (!input.dbUrl) {
    throw new Error("DB_URL is required before the local demo database can be reset.");
  }

  const targetUrl = new URL(input.dbUrl);
  const host = targetUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const databaseName = decodeURIComponent(targetUrl.pathname.replace(/^\//, ""));

  if (targetUrl.protocol !== "postgres:" && targetUrl.protocol !== "postgresql:") {
    throw new Error("Refusing to reset because DB_URL is not a PostgreSQL connection string.");
  }

  if (!SAFE_LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to reset database host "${targetUrl.hostname}". Only localhost, 127.0.0.1, or ::1 are allowed.`);
  }

  if (!SAFE_LOCAL_DATABASE_USERS.has(decodeURIComponent(targetUrl.username))) {
    throw new Error("Refusing to reset because the database user does not match the local Docker/demo user allowlist.");
  }

  if (!isSafeLocalDatabaseName(databaseName)) {
    throw new Error(`Refusing to reset database "${databaseName}". Use a local demo/dev/test database name such as pmc or pmc_demo.`);
  }

  const sslMode = targetUrl.searchParams.get("sslmode")?.toLowerCase();
  if (sslMode && !["disable", "prefer"].includes(sslMode)) {
    throw new Error(`Refusing to reset because DB_URL requests sslmode=${sslMode}, which does not look like the local Docker database.`);
  }

  const maintenanceUrl = new URL(targetUrl.toString());
  maintenanceUrl.pathname = "/postgres";
  return {
    databaseName,
    displayHost: `${targetUrl.hostname}${targetUrl.port ? `:${targetUrl.port}` : ""}`,
    maintenanceUrl: maintenanceUrl.toString()
  };
}

function quoteIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${value}`);
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function isSafeReportedServerAddress(value: string | null) {
  if (!value) {
    return true;
  }
  const address = value.replace(/^\[|\]$/g, "").replace(/\/\d+$/, "").toLowerCase();
  if (SAFE_LOCAL_HOSTS.has(address)) {
    return true;
  }
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }
  const [first = 0, second = 0] = parts;
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function runCommand(label: string, command: string, args: string[], cwd: string) {
  console.log(`\n== ${label} ==`);
  return new Promise<void>((resolvePromise, reject) => {
    const child = process.platform === "win32" ? spawn("cmd.exe", ["/d", "/s", "/c", [command, ...args].join(" ")], {
      cwd,
      stdio: "inherit",
      windowsHide: true
    }) : spawn(command, args, {
      cwd,
      stdio: "inherit",
      windowsHide: true
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code ?? "unknown"}.`));
    });
  });
}

async function resetDatabase(target: ResetTarget) {
  async function runMaintenanceQuery<T extends Record<string, unknown> = Record<string, unknown>>(sql: string) {
    const client = new Client({ connectionString: target.maintenanceUrl });
    await client.connect();
    try {
      return await client.query<T>(sql);
    } finally {
      await client.end();
    }
  }

  const server = await runMaintenanceQuery<{ server_addr: string | null }>(
    "SELECT inet_server_addr()::text AS server_addr"
  );
  const serverAddr = server.rows[0]?.server_addr?.toLowerCase() ?? null;
  if (!isSafeReportedServerAddress(serverAddr)) {
    throw new Error(`Refusing to reset because PostgreSQL reported non-local server address "${serverAddr}".`);
  }

  console.log(`Resetting local demo database "${target.databaseName}" on ${target.displayHost}.`);
  console.log("This command is for local pilot/demo review only.");

  await runMaintenanceQuery(`DROP DATABASE IF EXISTS ${quoteIdentifier(target.databaseName)} WITH (FORCE)`);
  await runMaintenanceQuery(`CREATE DATABASE ${quoteIdentifier(target.databaseName)}`);
}

function loadRepoEnv() {
  loadEnv({ path: resolveApiRepoPath(".env"), override: false });
  loadEnv({ path: resolve(resolveApiRepoRoot(), "..", ".env"), override: false });
}

async function main() {
  loadRepoEnv();
  const target = inspectLocalDemoResetTarget({
    dbUrl: process.env.DB_URL,
    nodeEnv: process.env.NODE_ENV,
    argv: process.argv
  });

  await resetDatabase(target);

  const apiPackageRoot = resolveApiRepoPath("packages", "api");
  const npmCommand = "npm";
  await runCommand("Running migrations", npmCommand, ["run", "migrate"], apiPackageRoot);
  await runCommand("Seeding local reference data", npmCommand, ["run", "seed", "--", "--redact-sensitive-output"], apiPackageRoot);
  await runCommand("Seeding Mission Control demo data", npmCommand, ["run", "seed:mission-control-demo"], apiPackageRoot);

  console.log("\nFresh local Mission Control demo database is ready.");
  console.log("Expected clean pilot signals:");
  console.log("- Home counts should be seed-sized instead of validation-sized.");
  console.log("- Photography Today should show 2 same-day seeded shoots.");
  console.log("- Schools and Sports operating boards should load with seeded rows.");
  console.log("- No stale dirty-state banner should appear.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
