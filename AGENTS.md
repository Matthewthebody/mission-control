# AGENTS.md

## Project
Internal operations app for Kemmetmueller Photography.
Purpose: ingest post-shoot evaluations, flag issues, generate a daily 6:00 a.m. America/Chicago leadership report, and retain report history.

## How to work
- Plan first for large changes.
- Prefer small, reviewable steps.
- Keep backend modules separated by concern:
  - ingestion
  - normalization
  - rules
  - ai_reporting
  - delivery
  - scheduler
- Avoid giant files.
- Prefer explicit naming over clever abstractions.

## Quality rules
- Run tests after major changes.
- Keep migrations clean and reversible.
- Do not hard-code monday.com field names in business logic.
- Source field mappings must be configurable.
- Deterministic rules should live in code/config, not be delegated to the model.

## AI rules
- Minimize prompt payload size.
- Redact student PII before model calls.
- Use OpenAI only for synthesis, prioritization, and narrative reporting.
- Report outputs must conform to an explicit schema.
- Log report runs and AI failures for audit.

## Done means
A feature is not done until:
- code is implemented
- tests pass
- docs are updated if behavior changed
- there is a clear way to verify the feature locally
