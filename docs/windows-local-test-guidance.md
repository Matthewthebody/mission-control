# Windows Local Test Guidance

## Purpose
Windows-local runs are useful for fast feedback, but they are not the release truth for Mission Control.

If local Vitest startup hits `spawn EPERM` or similar shell-startup failures, use Linux CI as the authoritative result and use the steps below to unblock local debugging.

## Known Local Failure Mode
- `npm run test -w packages/admin-web -- ...` or similar can fail before test execution with `spawn EPERM`.
- This is an environment/tooling failure, not automatically a product regression.

## Local Fallback Pattern
Run the equivalent Vitest suite directly from the workspace package with thread pool mode:

```powershell
cd packages\admin-web
npx vitest run --pool threads src/test/myWorkPage.test.tsx
```

```powershell
cd packages\api
npx vitest run --pool threads tests\microsoftEntraAuth.test.ts
```

```powershell
cd packages\worker
npx vitest run --pool threads tests\outlookGraph.test.ts
```

## Database-Backed Suites
Before DB-backed local suites:

```powershell
docker compose up -d
npm run db:migrate
npm run db:seed
```

If Docker Desktop is unavailable locally, do not block release decisions on that machine alone. Use the Linux CI workflow instead.

## Local Demo Browser Smoke
For a deterministic local browser smoke, start the API and admin web with:

```powershell
npm run dev:smoke
```

This pins the admin web to `http://localhost:5173` and fails fast if that port is already occupied. Use this command for browser smoke so the web origin and API CORS expectations stay predictable. Sign in with the local demo flow and verify:

```text
#home
#my-work
#needs-attention
#employees/attendance
#project-tracking
#schools
#sports
#studios
#directory/contacts
#accounts
```

If `npm run dev:smoke` reports that `5173` is already in use, stop the old Vite process before retrying. On Windows, you can find the owner with:

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen | Select-Object OwningProcess
```

Then inspect or stop that process from Task Manager, or use `Stop-Process -Id <OwningProcess>` when you are sure it is an old local dev server.

Normal `npm run dev` can still let Vite move to the next available local port. The API allows bounded local Vite fallback origins from `http://localhost:5173` through `http://localhost:5199` and matching `127.0.0.1` origins in non-production environments only. This keeps local development flexible without disabling browser security, using wildcard credentialed CORS, or allowing external origins.

## Release Rule
- Windows local: developer feedback
- Linux CI: release truth

Do not waive failing Linux smoke or build checks just because a Windows rerun happened to pass.
