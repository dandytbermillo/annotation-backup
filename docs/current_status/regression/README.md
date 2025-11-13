# Regression Evidence

Use this folder to stash the artifacts that prove parity between legacy and shell modes before turning the flag on.

## Required Items

1. Latest manual regression sheet exported to PDF (`manual-regression-YYYYMMDD.pdf`).
2. Playwright run output filtered to annotation scenarios (`playwright-annotation-YYYYMMDD.txt`).
3. `npm test -- annotation-app-shell-prop-parity.test.ts` log (`prop-parity-YYYYMMDD.txt`).
4. Any supplemental screenshots or Loom videos for high-risk flows.

After dropping the files here, update the checklist table in `docs/current_status/annotation-app-flag-flip.md` with filenames and owners.
