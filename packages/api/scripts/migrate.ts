import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pool } from "../src/db/pool.js";

function splitSqlStatements(sql: string) {
  const statements: string[] = [];
  let current = "";
  let index = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;

  while (index < sql.length) {
    const char = sql[index] ?? "";
    const next = sql[index + 1] ?? "";

    if (inLineComment) {
      current += char;
      index += 1;
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        index += 2;
        inBlockComment = false;
        continue;
      }
      index += 1;
      continue;
    }

    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length;
        dollarTag = null;
        continue;
      }
      current += char;
      index += 1;
      continue;
    }

    if (inSingleQuote) {
      current += char;
      index += 1;
      if (char === "'" && next === "'") {
        current += next;
        index += 1;
        continue;
      }
      if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      current += char;
      index += 1;
      if (char === "\"" && next === "\"") {
        current += next;
        index += 1;
        continue;
      }
      if (char === "\"") {
        inDoubleQuote = false;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      current += "--";
      index += 2;
      inLineComment = true;
      continue;
    }

    if (char === "/" && next === "*") {
      current += "/*";
      index += 2;
      inBlockComment = true;
      continue;
    }

    if (char === "'") {
      current += char;
      index += 1;
      inSingleQuote = true;
      continue;
    }

    if (char === "\"") {
      current += char;
      index += 1;
      inDoubleQuote = true;
      continue;
    }

    if (char === "$") {
      const tagMatch = sql.slice(index).match(/^(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/);
      if (tagMatch) {
        const tag = tagMatch[1];
        current += tag;
        index += tag.length;
        dollarTag = tag;
        continue;
      }
    }

    if (char === ";") {
      const statement = current.trim();
      if (statement.length > 0) {
        statements.push(statement);
      }
      current = "";
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  const trailing = current.trim();
  if (trailing.length > 0) {
    statements.push(trailing);
  }
  return statements;
}

async function run() {
  const migrationsDir = resolve(process.cwd(), "../../db/migrations");
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_migration (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const file of files) {
    const existing = await pool.query("SELECT 1 FROM app_migration WHERE filename = $1", [file]);
    if (existing.rowCount) {
      continue;
    }
    const sql = await readFile(join(migrationsDir, file), "utf8");
    const runWithoutTransaction = /^\s*--\s*migrate:\s*no-transaction\b/im.test(sql);
    const client = await pool.connect();
    try {
      if (runWithoutTransaction) {
        for (const statement of splitSqlStatements(sql)) {
          await client.query(statement);
        }
        await client.query("INSERT INTO app_migration (filename) VALUES ($1)", [file]);
      } else {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO app_migration (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
      }
      // eslint-disable-next-line no-console
      console.log(`Applied migration ${file}`);
    } catch (error) {
      if (!runWithoutTransaction) {
        await client.query("ROLLBACK");
      }
      throw error;
    } finally {
      client.release();
    }
  }

  await pool.end();
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
