import * as SQLite from "expo-sqlite";

export const db = SQLite.openDatabaseSync("pmc-mobile.db");

export function initDb() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS offline_queue (
      id TEXT PRIMARY KEY NOT NULL,
      shoot_id TEXT,
      request_path TEXT,
      request_method TEXT,
      request_headers TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS field_form_draft (
      draft_key TEXT PRIMARY KEY NOT NULL,
      form_kind TEXT NOT NULL,
      shift_id TEXT,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const legacyMigrations = [
    "ALTER TABLE offline_queue ADD COLUMN shoot_id TEXT",
    "ALTER TABLE offline_queue ADD COLUMN request_path TEXT",
    "ALTER TABLE offline_queue ADD COLUMN request_method TEXT",
    "ALTER TABLE offline_queue ADD COLUMN request_headers TEXT"
  ];

  for (const statement of legacyMigrations) {
    try {
      db.execSync(statement);
    } catch {
      // Column already exists in upgraded local databases.
    }
  }
}
