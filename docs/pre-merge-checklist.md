# Pre-merge Checklist

## Required Before Merge

- [ ] API builds from source
- [ ] worker builds
- [ ] admin-web builds
- [ ] mobile TypeScript check passes
- [ ] API tests pass
- [ ] worker tests pass
- [ ] admin-web tests pass
- [ ] pilot smoke suite passes for:
  - [ ] jobs
  - [ ] exceptions
  - [ ] My Work
  - [ ] portal MVP
  - [ ] Microsoft auth / Outlook / Teams / webhooks where implemented
- [ ] Linux `Linux Release Truth` workflow is green on the release candidate commit
- [ ] rollback toggles are verified for portal and Microsoft surfaces
- [ ] compatibility register is current

## Verify Commands

Run the exact repo commands below and record the results:

```powershell
npm run db:migrate
npm run db:seed
npm run build -w packages/api
npm run test -w packages/api
npm run build -w packages/worker
npm run test -w packages/worker
npm run build -w packages/admin-web
npm run test -w packages/admin-web
npx tsc -p packages/mobile/tsconfig.json --noEmit
npm run smoke:pilot
```

Or run the consolidated verification scripts:

```powershell
npm run verify:api
npm run verify:admin
npm run verify:mobile
npm run smoke:pilot
```

## Notes

- Do not rely on summary-only status reports.
- Record the exact commands run and save logs when possible.
- If admin-web tests are failing because the harness changed, fix or remove the regression before merge instead of waiving it silently.
- Linux CI is the release truth. Local Windows reruns are advisory only when `spawn EPERM` blocks Vitest startup.
- Use [windows-local-test-guidance.md](./windows-local-test-guidance.md) for the local fallback pattern.
- Use [release-pilot-checklist.md](./release-pilot-checklist.md) for the pilot sign-off gate, observability checks, and rollback toggles.
