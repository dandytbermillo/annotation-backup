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

---

## Core Principle – “Trust Nothing, Verify Everything”

1. **Never claim without evidence**  
   - Provide exact file paths, line numbers, and tool outputs for every statement.
   - Prefer quotes lifted from the source over summaries.

2. **Always read the current file**  
   - Files might have changed since you last touched them. Use the read tool before citing content.

3. **Execute real commands**  
   - Run docker/curl/npm commands instead of describing expected behaviour.
   - Capture actual stdout/stderr; note timestamps when possible.

4. **Test malicious inputs, not just happy paths**  
   - Prove that attacks fail (invalid gradients, nested `__proto__`, etc.).
   - Then confirm valid payloads still succeed (no false positives).

5. **Verify database state directly**  
   - Query Postgres to ensure migrations, triggers, and stored functions exist and contain the expected logic.

6. **Stress edge cases and deep recursion**  
   - Test multi-level nesting, arrays of objects, null/empty values—especially for recursive sanitizers.

7. **Distinguish between “I wrote it” and “It exists”**  
   - Re-read files even if you authored the change; the repo could have diverged.

8. **Cross-verify with multiple sources**  
   - Combine code inspection, database queries, and runtime tests to bolster confidence.

9. **Provide line numbers and exact quotes**  
   - Makes your verification reproducible and reviewable.

10. **Document both positive and negative cases**  
    - Show that attacks fail and legitimate scenarios still work.

11. **Log every verification step**  
    - Record the sequence of reads/commands/tests in the feature’s verification report.

12. **Account for caching and state**  
    - Test create/update/delete flows to confirm registry/cache invalidation is working.

Use the “✅ checklist” below before writing “verified” in any report.

### Remember the Critical Patterns

- **Cache / lifecycle checks**  
  1. Create resource  
  2. Verify it appears via read (proves cache invalidated)  
  3. Update resource  
  4. Re-read to confirm update visible  
  5. Delete resource  
  6. Re-read to confirm removal  
  Skipping any step risks missing cache-invalidation bugs.

- **Show your work**  
  Log each step explicitly (file inspected, command executed, response observed). “Everything works” without evidence is not verification.

- **Cross-method confirmation**  
  Validate the same behaviour from multiple angles (code read, DB query, runtime call). High confidence comes from concordant results.

- **Both negative and positive cases**  
  Demonstrate that attacks fail **and** legitimate flows still work. Blocking bad input is insufficient if good input breaks.

### Quick Self-Check (✅ / ❌)
- Did I **read the current** file contents?
- Did I **run concrete commands** instead of guessing?
- Did I test **malicious inputs** and see them blocked?
- Did I **query the database** for ground truth?
- Did I explore **deep nesting / edge cases**?
- Did I **cross-verify** via code + DB + runtime?
- Did I quote the **specific lines** I saw (with timestamps if possible)?
- Did I test both **attack fail** and **valid success** paths?
- Did I **document outputs** and attach proof?
- Did I re-run a scenario after **cache invalidation**?

If any box is unchecked, keep investigating—your verification isn’t complete yet.
