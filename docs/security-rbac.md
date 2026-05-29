# Security and RBAC Matrix

This matrix documents expected access boundaries for major Mission Control areas. It is a product/security contract, not a substitute for route-level tests.

## Roles and Access Expectations

| Area | Owner/Admin | Leadership/Director | Senior Photographer / Shoot Lead | Associate / Photographer | Production / Graphics | Payroll/Admin | General Staff |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Project Tracking | manage | view/manage operationally | view assigned/job-relevant | view assigned | view production-relevant | view where needed | limited/assigned |
| Workflow Templates | manage | manage | no manage unless permissioned | no | no manage unless permissioned | no | no |
| Checklist Templates | manage | manage where permissioned | no manage unless permissioned | no | no manage unless permissioned | no | no |
| Job Closeout | manage/read | read/manage reports | submit/read assigned | submit lightweight assigned | read relevant production context | read mileage/payroll parts where permissioned | assigned only |
| Mileage Review | manage | review/report | no broad review | no broad review | no | manage/review | no |
| Compliance Workspace | view/manage review | view/manage review | no broad access unless permissioned | no | no broad access unless permissioned | view/manage payroll-relevant review | no |
| Client Command Center | manage/read | read/manage | limited job-relevant | no broad access | limited account/job context | billing/account context where permissioned | no |
| Reports | all | leadership reports | assigned/team only | own/assigned only | production reports where permissioned | payroll reports | limited |
| Feature Flags/Admin Config | manage | view where safe | no | no | no | no | no |

## Authentication Contract

- `dev-login` is local/test only.
- Production must not expose `dev-login`.
- Production auth should use real auth providers and safe session/cookie settings.
- Test shortcuts must be visibly tied to `NODE_ENV !== "production"` or explicit local flags.

## Authorization Rules

- Template management is leadership/admin only unless a user has explicit workflow template management permission.
- Mileage review is payroll/admin/leadership scoped.
- Compliance is leadership/admin/director/supervisor or explicit compliance/attendance approval permission.
- Field users should receive job-relevant operational context, not broad personnel/performance reports.
- Feature flags should fail closed for integration delivery.

## Audit Logging Expectations

Sensitive actions should be auditable:

- publish/archive workflow template
- submit post-shoot evaluation
- create/approve/void mileage review
- resolve/snooze operational flags
- generate report snapshots
- change feature flags once runtime management exists

## Known Gaps

- Feature flags are documented but not yet visible in a read-only admin registry.
- Some older shared workflow backbone tables still need a full RLS audit before broad policy changes.
- Native file upload/storage policy should be revisited when attachment upload moves beyond metadata/foundation.
