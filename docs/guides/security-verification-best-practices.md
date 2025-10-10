# Security Verification Best Practices (Project-wide)

Use this high-level checklist whenever youre asked to verify a security fix or feature within this repository. It focuses on the mindset and steps to follow rather than specific commands, so it applies across different modules (API, UI, migrations, etc.).

---

## 1. Understand the Requirement
- Clarify the vulnerability being addressed (root cause, attack vector, intended fix).
- Identify which layers are involved (application code, database, client, infrastructure).
- Review the relevant proposal/spec or implementation plan for acceptance criteria.

## 2. Inspect Code Changes Thoroughly
- Confirm the fix is applied everywhere the vulnerability can emerge (multiple endpoints, shared utilities, etc.).
- Look for defense-in-depth: validation, sanitisation, and authorization checks at each layer.
- Check for new side effects (e.g., changes to error handling, data flow, caching).
- Ensure backward compatibility unless intentionally breaking.

## 3. Verify Testing Prerequisites
- Make sure required services are running (Next.js server, PostgreSQL, queues, etc.).
- Confirm you have access to the environment and tooling (CLI, docker, test scripts).
- Update test data or seeds if the fix depends on specific records or migrations.

## 4. Execute Validation Steps (High-Level)
- **Static checks**: type-checking, linting, automated tests relevant to the fix.
- **Runtime checks**: manual or scripted execution against expected inputs (both malicious and benign).
- **Database checks**: validate constraints, triggers, stored procedures if data integrity is part of the fix.
- **Regression checks**: ensure unaffected paths still behave as before (positive cases).

## 5. Capture Evidence
- Record commands run and their outputs (screenshots, logs, or copy/paste).
- Note any anomalies, unexpected warnings, or follow-up work.
- Store verification notes in the appropriate report under `docs/proposal/.../reports/`.

## 6. Cleanup & Sanity Checks
- Remove temporary test data created during verification.
- Re-run the application briefly to ensure no lingering errors or leaked state.
- Update documentation/checklists with any new lessons or steps discovered.

## 7. Communicate Findings
- Summarise results clearly: PASS / FAIL / NEEDS WORK, highlighting blockers.
- Provide actionable feedback (code locations, repro steps, suggested fixes).
- Link to verification evidence (logs, commits, reports) for future audits.

---

Following this framework keeps each security review consistent, reproducible, and audit-ready. When specific commands or scripts are needed, create or update feature-specific checklists in `docs/verification/` and link them back to this best-practices guide.
