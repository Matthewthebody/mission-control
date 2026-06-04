# Pilot Review Setup

Use this checklist before a live Mission Control pilot review with Matthew, Jessica, Carisa, Spencer, or senior photographers. The goal is to start from a clean local demo database instead of a database that has accumulated validation or test records.

## 1. Start From The Intended Branch

From the repo root:

```powershell
git status --short --branch
git branch --show-current
git rev-parse --short HEAD
```

Expected:

- Branch is `feature/mission-control-demo-readiness-v1`.
- Working tree is clean.
- You are using the local repo at `C:\Dev\Codex-integrated-baseline-clean`.

## 2. Start Local Services

Start the local Docker services:

```powershell
docker compose up -d
docker compose ps
```

Expected:

- Postgres is running on local port `5432`.
- Redis is running on local port `6379`.

## 3. Rebuild The Local Demo Database

Run the local-only reset command:

```powershell
npm run db:reset:demo
```

This command is intentionally guarded. It refuses to run unless the configured database is clearly local/dev/demo, and it will not run in production mode.

What it does:

- Drops and recreates only the configured local demo/dev database.
- Runs migrations.
- Seeds local reference/demo account data with sensitive output redacted.
- Seeds Mission Control demo data.
- Prints the expected clean pilot signals.

## 4. Start Mission Control

```powershell
npm run dev
```

Then open:

```text
http://localhost:5173/#home
```

## 5. Review Routes

Open these routes first:

- `#home`
- `#schools`
- `#sports`
- `#studios`
- `#project-tracking`
- `#schedule`

## 6. Expected Clean Demo Signals

Home:

- Counts look reasonable and seed-sized.
- No stale dirty-state banner appears.
- Concierge/search is visible in the Home header.
- New Task is reachable.

Photography:

- `#studios` opens Photography Today.
- Today's Photography Shoots shows 2 same-day seeded shoots.
- Travel details, Job Prep / Readiness, Open details, and 30-Day Planning Calendar are visible.

Schools:

- Schools Operating Board loads with useful seeded rows.

Sports:

- Sports Operating Board loads with useful seeded rows.
- New Sports Job route is reachable.

Project Tracking and Schedule:

- `#project-tracking` loads.
- `#schedule` loads.

## 7. If Counts Look Inflated Again

Inflated Home counts usually mean the local database has accumulated validation/test records again. Do this before the next human walkthrough:

```powershell
npm run db:reset:demo
```

Do not use broad manual SQL deletes for pilot setup. If the reset command refuses to run, stop and inspect the database target before proceeding.
