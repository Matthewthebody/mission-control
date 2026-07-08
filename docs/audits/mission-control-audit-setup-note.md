# Mission Control Full-System Audit — Setup Note

Date: 2026-07-08
Auditor: Claude (Fable 5) — three-agent scouting method

## Repo State (Safety Check)

- **Repo:** `C:\Dev\Codex-integrated-baseline-clean`
- **Branch:** `feature/work-spine-foundation-v1`
- **HEAD:** `fe5853e8f85789c1b93d62830cd63075ab73a629` — "Document School Season Autopilot sprint 1"
- **Working tree:** CLEAN (no dirty files, no untracked app code). Safe to audit.
- **Recent commits:** Labor Command Center (migrations 165–166, API, worker, surfaces), route resolution fixes, G-series hardening audit, Phase 6A Schools Leadership closure.
- **Safety posture:** Audit-only. No app code changes. No commits. Only `docs/audits/*.md` files created.

## Stack Identification

- **Package manager:** npm workspaces — `packages/*` + `tools/migrate`
- **Workspaces:**
  - `packages/api` — backend API (port **4000**), owns migrations/seeds/tests
  - `packages/admin-web` — React + Vite frontend (port **5173**, hash-based routing `#...`), vitest (`--maxWorkers 1`)
  - `packages/worker` — background jobs (labor monitor, reminders, overtime sweep)
  - `packages/mobile` — Expo SDK 54 app (typecheck only via `verify:mobile`)
  - `packages/timeclock-core` — shared timeclock logic
- **Database:** Postgres + Redis via `docker-compose.yml` — **both containers running** (up 3h)
- **Migrations:** `db/migrations` — **166 files**, head = `166_labor_command_center_phase2.sql`
- **Key commands:**
  - Dev: `npm run dev` (api+worker+web), `npm run dev:smoke` (api+web, strict port 5173)
  - DB: `npm run db:migrate`, `db:seed`, `db:reset:demo`, `seed:mission-control-demo`, `project-tracking:seed-demo`, `client-command-center:seed-demo`
  - Tests: `npm test` (api), `verify:api`, `verify:admin`, `verify:mobile`, `smoke:pilot` bundle, `lint`
- **Auth / dev login:** seeded local accounts, password `LocalDemo123!` — roles: `owner_admin` (matthew@example.com), `admin`, `leadership`, `senior_photographer`, legacy `photographer`, `associate_photographer`, `office_employee`, `pending_approval`, `suspended`.

## Docs Found

`docs/` is dense with prior audits and closure reports (30+), including: `phase4-directory-schools-canonical-audit.md`, `phase6a-schools-canonical-source-audit.md`, `mission-control-actionability-audit.md`, `mission-control-production-readiness-gap-audit.md`, `jobs-shoot-convergence-audit.md`, `security-rbac.md`, `performance-budgets.md`, `work-spine-foundation-handoff.md`, `docs/architecture/`, `db/migrations/`. AGENTS.md documents module-separation and quality rules (originally scoped to post-shoot evaluation ingestion; product has grown far beyond it).

## Entry Points

- Frontend: `packages/admin-web/src` (Vite; hash-routing e.g. `#schools/leadership`, `#operations/staffing`)
- Backend: `packages/api/src` (routes incl. `/api/labor`, directory/intake APIs)
- Schema: `db/migrations/*.sql` (001–166)
- Seeds/demo: api workspace seed scripts (`seed:mission-control-demo` etc.)

## Immediate Risks / Uncertainty

1. **Prior-session context:** A concurrent labor/payroll workstream landed recently (migrations 165–166); tree is now clean, but Labor Command Center is the newest, least-hardened surface.
2. **Root-level dev-smoke logs** (`dev-smoke*.log`, `tmp-*.log`) suggest ad-hoc dev runs; ports 4000/5173 may or may not be occupied — scouts must check before starting servers.
3. **AGENTS.md scope drift:** repo instructions describe a much smaller product than what exists — a documentation-truth question in itself.
4. **166 migrations, many phases:** high likelihood of legacy/canonical coexistence (known: jobs vs shoots convergence, legacy project tracking vs Production Tracker, org layer migration 144).
5. Docker containers already running — DB state may be demo-seeded from prior sessions; scouts should verify seed freshness rather than assume.

## Plan

Three scout agents (A: source-of-truth/architecture; B: UX/role workflows; C: runtime QA/security/tests/perf), each producing a markdown report in `docs/audits/`, followed by a coordinator synthesis: `mission-control-full-system-audit.md`.
