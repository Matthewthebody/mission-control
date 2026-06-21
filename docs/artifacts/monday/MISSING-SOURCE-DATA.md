# Phase 5 — Missing Source Data

Generated: 2026-06-21T01:52:42.085Z

The pilot ran against SANITIZED SAMPLE fixtures because no real Monday board export exists in the repo.
To run a real dry run, provide the following under docs/artifacts/monday/ and re-point the pilot:

1. A board-list export (workspace, board_id, board_name, owner, department, lifecycle) for all boards (~76).
2. Per pilot board: a structure export (groups + columns with ids/types) and a representative, sanitized item export (column values, subitems, updates, attachment references).
3. Board-level automations / integrations to confirm the side-effect scope to suppress.

Until provided, no production rows are invented and no import is possible.
