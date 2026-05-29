# Project Tree

```text
.
|-- db/
|   `-- migrations/
|-- docs/
|-- packages/
|   |-- admin-web/
|   |-- api/
|   |-- mobile/
|   `-- worker/
|-- tools/
|   `-- migrate/
|-- .env.example
|-- IMPLEMENTATION_NOTES.md
|-- docker-compose.yml
|-- package.json
`-- README.md
```

Key runtime flows:

- `packages/api`: Express API, Socket.io server, RLS transaction handling, session-backed auth, centralized policy checks, user access management, uploads, and CRUD endpoints.
- `packages/worker`: BullMQ repeat jobs for outbox processing and alert evaluation, plus internal realtime publishing and push stubs.
- `packages/admin-web`: admin surfaces for login, live shoots, alerts, users and access, audit review, and my account.
- `packages/mobile`: Expo scaffold with password login plus local dev-login fallback, offline SQLite queue, and later replay using stable `client_event_id`.
- `tools/migrate`: small stubs for Monday GraphQL and Airtable REST import helpers.
