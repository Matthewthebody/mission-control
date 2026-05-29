# Recovered Mission Control Context

Recovered on: 2026-05-29
Safe local repo: C:\Dev\Codex-integrated-baseline
Old OneDrive sources:
- C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex
- C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex-integrated-baseline

## Recovery Result

Recovered readable Mission Control planning, handoff, review, and release-context files into this folder. No `.env` files or secret-bearing files were copied or printed.

## Recovered Folders

- `old_codex_quarantine/`: historical Codex artifact handoffs, planning docs, review packets, UI cleanup notes, operations refactor notes, prompt-phase handoffs, and product/architecture summaries.
- `old_repo_docs/`: newer docs from the old OneDrive repo copy, including Mission Control demo walkthrough, project tracking foundation, workflow template builder, release gate/checklist, schools workflow parity, and the release runtime smoke artifact.

## Important Guardrails Found / Preserved

- Use `C:\Dev\Codex-integrated-baseline` for active work going forward.
- Do not use the OneDrive worktree for npm, Docker, migrations, tests, or git mutations.
- Keep feature work separate from environment recovery.
- Do not print secrets or `.env` contents.
- Maintain pilot readiness gates: install, Docker services, migrations, base seed, demo seed, and `verify:pilot-mode`.
- Mission Control surfaces repeatedly referenced in recovered docs include My Work, Production Queue, workflow templates, dashboard/command center, canonical shoot/directory links, post-shoot evaluation, mobile upload, resource library, time clock, and operations refactor work.

## Files Recovered

### old_codex_quarantine

- PRODUCT_NORTH_STAR.md
- GAP_ANALYSIS.md
- DASHBOARD_SPEC.md
- CORE_WORKFLOW_SPEC.md
- PHASE_1_EXECUTION_PLAN.md
- IA_ROUTE_MAP.md
- IMPLEMENTATION_SUMMARY.md
- NEXT_BATCH_RECOMMENDATIONS.md
- CHANGED_FILES_OVERVIEW.md
- DESIGN_DECISIONS.md
- UI_CONSOLIDATION_NOTES.md
- UI_CLEANUP_SUMMARY.md
- ROLE_PERMISSION_MATRIX.md
- ROLE_NAV_IMPLEMENTATION_NOTES.md
- DASHBOARD_ARCHITECTURE.md
- NOTIFICATION_CENTER_ARCHITECTURE.md
- OPERATIONS_REFACTOR_MASTER_HANDOFF.md
- PHASE1_SHELL_STABILITY_HANDOFF.md
- PHASE2_OPERATIONS_CALENDAR_HANDOFF.md
- PHASE3_LEADERSHIP_SCHEDULING_HANDOFF.md
- PHASE4_OUTLOOK_SYNC_HANDOFF.md
- PHASE5_SHOOTS_WORKSPACE_HANDOFF.md
- PHASE6_LOCATION_GUIDE_HANDOFF.md
- PHASE7_COMMAND_CENTER_HANDOFF.md
- PROMPT1_CANONICAL_DIRECTORY_HANDOFF.md
- PROMPT2_CANONICAL_SHOOT_LINKS_HANDOFF.md
- PROMPT3_RESOURCE_LIBRARY_HANDOFF.md
- PROMPT4_MOBILE_UPLOAD_HANDOFF.md
- PROMPT5_POST_SHOOT_EVALUATION_HANDOFF.md
- PROMPT6_TIME_CLOCK_PHASE1_HANDOFF.md
- CLIENT_OPERATIONS_CORE_HANDOFF.md
- CLIENT_OPERATIONS_CORE_PROMPT6_HANDOFF.md
- CLIENT_OPERATIONS_CORE_PHASE_G8_HANDOFF.md
- PROFITABILITY_PHASE0_HANDOFF.md
- PRODUCT_ENGINEERING_NEXT_PHASE_PLAN.md
- LEADERSHIP_RELEASE_ANNOUNCEMENT.md
- HOME_TV_QA_UAT_CHECKLIST.md
- CODEX_REVIEW_PACKET.md
- CHATGPT_REVIEW_PACKET.md
- REPO_HONESTY_AND_CLEANUP_REVIEW.md
- UX_DECLUTTER_AND_PREVIEW_MODEL_REVIEW.md
- API_VALIDATION_STATUS.md

### old_repo_docs

- mission-control-demo-walkthrough.md
- project-tracking-foundation.md
- workflow-template-builder-v1.md
- release-pilot-checklist.md
- release-gate.md
- schools-workflow-automation-parity.md
- pre-merge-checklist.md
- release-runtime-smoke.json

## OneDrive Readability Notes

The selected files above copied successfully. During broader search, several deeper OneDrive artifact/export files were unreadable with the error `The cloud file provider exited unexpectedly`. These were mostly under:

- C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\.codex-artifacts\quarantine\docs\microsoft365\...
- C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\.codex-artifacts\quarantine\CODEX_EXPORT\verify-*\...
- C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\.codex-artifacts\quarantine\docs\morning-post-shoot-review\...

Those unreadable files were not required for the local Mission Control baseline recovery and were not retried indefinitely.
