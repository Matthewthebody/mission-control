import { Pool } from "pg";
import type { PoolClient, QueryArrayConfig, QueryConfig, QueryResult, QueryResultRow } from "pg";
import { config } from "../config.js";
import { getRequestContext } from "../services/requestContext.js";

type QueryInput<T extends QueryResultRow = QueryResultRow> = string | QueryConfig<T[]> | QueryArrayConfig<T[]>;

type QueryArgs<T extends QueryResultRow = QueryResultRow> =
  | [queryTextOrConfig: QueryInput<T>, values?: unknown[]]
  | [queryTextOrConfig: QueryInput<T>, callback: (error: Error | null, result: QueryResult<T>) => void]
  | [queryTextOrConfig: QueryInput<T>, values: unknown[], callback: (error: Error | null, result: QueryResult<T>) => void];

type QueryFn = <T extends QueryResultRow = QueryResultRow>(...args: QueryArgs<T>) => Promise<QueryResult<T>>;
type GuardableQuery = <T extends QueryResultRow = QueryResultRow>(...args: QueryArgs<T>) => unknown;
type InstrumentedClient = PoolClient & { __pmcGuardedQuery?: boolean; __pmcQueryTail?: Promise<void> };

const MUTATING_SQL_KEYWORDS = new Set([
  "insert",
  "update",
  "delete",
  "merge",
  "alter",
  "create",
  "drop",
  "truncate",
  "reindex",
  "grant",
  "revoke",
  "comment",
  "vacuum",
  "refresh",
  "analyze",
  "copy"
]);

const SQL_COMMENT_PREFIX = /^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*/;

export class ReadOnlyRequestMutationError extends Error {
  readonly method: string;
  readonly path: string;
  readonly sql: string;

  constructor(method: string, path: string, sql: string) {
    super(`Read-only request attempted to execute a mutating SQL statement (${method} ${path}).`);
    this.name = "ReadOnlyRequestMutationError";
    this.method = method;
    this.path = path;
    this.sql = sql;
  }
}

export function normalizeSqlText(input: string) {
  return input.replace(SQL_COMMENT_PREFIX, "").trimStart();
}

export function isMutatingSql(input: string) {
  const normalized = normalizeSqlText(input).toLowerCase();
  if (!normalized) {
    return false;
  }
  const firstToken = normalized.match(/^[a-z]+/)?.[0] ?? "";
  if (MUTATING_SQL_KEYWORDS.has(firstToken)) {
    return true;
  }
  if (firstToken !== "with") {
    return false;
  }
  return /(?:\(\s*|\)\s*)(?:insert\s+into|update\b|delete\s+from|merge\s+into)\b/i.test(normalized);
}

export function assertRequestQueryAllowed(method: string | null | undefined, path: string | null | undefined, sql: string) {
  if (!config.DB_READONLY_GET_ENFORCEMENT) {
    return;
  }
  const context = getRequestContext();
  if ((method ?? "").toUpperCase() !== "GET") {
    return;
  }
  if (context?.operationType === "action") {
    return;
  }
  if (!isMutatingSql(sql)) {
    return;
  }
  throw new ReadOnlyRequestMutationError(method ?? "GET", path ?? "unknown", sql);
}

function extractQueryText(input: QueryInput | undefined) {
  if (typeof input === "string") {
    return input;
  }
  if (input && typeof input === "object" && "text" in input && typeof input.text === "string") {
    return input.text;
  }
  return "";
}

function buildSlowQuerySummary(sql: string) {
  const normalized = normalizeSqlText(sql).replace(/\s+/g, " ").trim();
  return normalized.slice(0, 180);
}

function logSlowQuery(durationMs: number, sql: string, source: "pool" | "client") {
  if (durationMs < config.DB_SLOW_QUERY_THRESHOLD_MS) {
    return;
  }
  const context = getRequestContext();
  console.warn(
    "[db.slow_query]",
    JSON.stringify({
      duration_ms: durationMs,
      threshold_ms: config.DB_SLOW_QUERY_THRESHOLD_MS,
      source,
      request_id: context?.requestId ?? null,
      method: context?.method ?? null,
      path: context?.path ?? null,
      sql: buildSlowQuerySummary(sql)
    })
  );
}

function wrapGuardedQuery(source: "pool" | "client", query: GuardableQuery): GuardableQuery {
  return ((...args: QueryArgs) => {
    const sql = extractQueryText(args[0]);
    const context = getRequestContext();
    if (sql) {
      assertRequestQueryAllowed(context?.method, context?.path, sql);
    }
    const startedAt = Date.now();
    const finalize = () => {
      if (sql) {
        logSlowQuery(Date.now() - startedAt, sql, source);
      }
    };

    const maybeCallback = args.at(-1);
    if (typeof maybeCallback === "function") {
      const callbackArgs = [...args] as unknown[];
      callbackArgs[callbackArgs.length - 1] = (error: Error | null, result: QueryResult<QueryResultRow>) => {
        finalize();
        (maybeCallback as (error: Error | null, result: QueryResult<QueryResultRow>) => void)(error, result);
      };
      return query(...(callbackArgs as QueryArgs));
    }

    const result = query(...args);
    if (result && typeof result === "object" && "finally" in result && typeof result.finally === "function") {
      return (result as Promise<QueryResult<QueryResultRow>>).finally(finalize);
    }
    finalize();
    return result;
  }) as GuardableQuery;
}

function instrumentClient(client: PoolClient) {
  const instrumented = client as InstrumentedClient;
  if (instrumented.__pmcGuardedQuery) {
    return client;
  }
  const originalQuery = client.query.bind(client) as GuardableQuery;
  instrumented.query = wrapGuardedClientQuery(instrumented, originalQuery) as typeof client.query;
  instrumented.__pmcGuardedQuery = true;
  return instrumented;
}

function enqueueClientQuery<T>(client: InstrumentedClient, run: () => Promise<T>): Promise<T> {
  const tail = client.__pmcQueryTail ?? Promise.resolve();
  const next = tail.catch(() => undefined).then(run);
  client.__pmcQueryTail = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function wrapGuardedClientQuery(client: InstrumentedClient, query: GuardableQuery): GuardableQuery {
  return ((...args: QueryArgs) => {
    const sql = extractQueryText(args[0]);
    const context = getRequestContext();
    if (sql) {
      assertRequestQueryAllowed(context?.method, context?.path, sql);
    }

    return enqueueClientQuery(client, () => {
      const startedAt = Date.now();
      const finalize = () => {
        if (sql) {
          logSlowQuery(Date.now() - startedAt, sql, "client");
        }
      };

      const maybeCallback = args.at(-1);
      if (typeof maybeCallback === "function") {
        return new Promise<QueryResult<QueryResultRow>>((resolve, reject) => {
          let finalized = false;
          const finalizeOnce = () => {
            if (finalized) {
              return;
            }
            finalized = true;
            finalize();
          };

          const callbackArgs = [...args] as unknown[];
          callbackArgs[callbackArgs.length - 1] = (error: Error | null, result: QueryResult<QueryResultRow>) => {
            finalizeOnce();
            (maybeCallback as (error: Error | null, result: QueryResult<QueryResultRow>) => void)(error, result);
            if (error) {
              reject(error);
              return;
            }
            resolve(result);
          };

          try {
            const callbackResult = query(...(callbackArgs as QueryArgs));
            if (callbackResult && typeof callbackResult === "object" && "catch" in callbackResult && typeof callbackResult.catch === "function") {
              (callbackResult as Promise<QueryResult<QueryResultRow>>).catch((error) => {
                finalizeOnce();
                reject(error);
              });
            }
          } catch (error) {
            finalizeOnce();
            reject(error);
          }
        });
      }

      try {
        const result = query(...args);
        if (result && typeof result === "object" && "finally" in result && typeof result.finally === "function") {
          return (result as Promise<QueryResult<QueryResultRow>>).finally(finalize);
        }
        finalize();
        return Promise.resolve(result as QueryResult<QueryResultRow>);
      } catch (error) {
        finalize();
        return Promise.reject(error);
      }
    });
  }) as GuardableQuery;
}

export function instrumentGuardedClientForTesting<T extends { query: GuardableQuery }>(client: T): T {
  return instrumentClient(client as unknown as PoolClient) as unknown as T;
}

export const pool = new Pool({
  connectionString: config.DB_URL
});

const originalPoolQuery = pool.query.bind(pool) as GuardableQuery;
pool.query = wrapGuardedQuery("pool", originalPoolQuery) as typeof pool.query;

const originalPoolConnect = pool.connect.bind(pool);
export async function connectGuardedClient() {
  const client = await originalPoolConnect();
  return instrumentClient(client);
}
