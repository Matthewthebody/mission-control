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
For a local browser smoke, start the API and admin web with:

```powershell
npm run dev
```

Vite normally opens the admin web on `http://localhost:5173`. If that port is already occupied, Vite may move to the next available local port, such as `http://localhost:5174` or `http://localhost:5175`. Use the `Local:` URL printed by Vite, then sign in with the local demo flow and verify:

```text
#home
#my-work
#needs-attention
#employees/attendance
```

The API allows known local Vite fallback origins in non-production environments only, so this smoke path should work without disabling browser security.

## Release Rule
- Windows local: developer feedback
- Linux CI: release truth

Do not waive failing Linux smoke or build checks just because a Windows rerun happened to pass.
