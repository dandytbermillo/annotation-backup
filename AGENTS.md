# Repository Guidelines

## Project Structure & Module Organization
- `app/`: Next.js 15 app (routes, pages, API under `app/api/`).
- `components/`: Reusable React 19 components.
- `lib/`: Shared TypeScript utilities.
- `docs/`: Architecture/proposal docs (e.g., `unified_offline_foundation/`).
- `codex/`: Advisory patches, scripts, and session notes (not deployed).
- `tests/` or `__tests__/`: Unit/integration tests (if present).

## Build, Test, and Development Commands
- `npm run dev`: Start the Next.js dev server (hot reload).
- `npm run build`: Create a production build.
- `npm start`: Serve the production build.
- `npm test`: Run unit tests (if configured).
- `npx playwright test` or `npm run test:e2e`: Run E2E tests (if configured).
- `bash codex/scripts/bench-api.sh`: Baseline key API timings (outputs to `codex/benchout/`).

## Coding Style & Naming Conventions
- TypeScript: Explicit types at public boundaries; avoid `any`.
- Indentation: 2 spaces; no trailing whitespace.
- Naming: `camelCase` (vars/functions), `PascalCase` (components/types), kebab-case (filenames; components may use `PascalCase.tsx`).
- Lint/Format: Use ESLint/Prettier if configured; run before committing.
- API routes: Keep handlers small, typed, and consistent with file-based routing under `app/api/...`.

## Testing Guidelines
- Unit tests: Co-locate or place under `tests/`; name `*.test.ts` or `*.test.tsx`.
- E2E: Place under a `playwright/` directory if used; keep tests deterministic.
- Coverage: Prioritize core logic (adapters, API handlers). Avoid brittle visual snapshots.
- CI: Ensure tests run headless and do not rely on local state.

## Commit & Pull Request Guidelines
- Commits: Prefer Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`).
- PRs: Include a clear description, linked issues, screenshots/logs where relevant, and brief test notes.
- Scope: Keep PRs focused and small; feature-flag risky changes.

## Security & Configuration Tips
- Environment: Use `.env.local`; never commit secrets.
- Postgres: Ensure extensions used by patches are enabled (e.g., `pgcrypto`, `pg_trgm`, `unaccent`).
- Validation: Coerce/validate IDs at API boundaries; always use parameterized queries.

## Agent-Specific Instructions (codex/)
- `codex/` is read-only advisory space: propose diffs as patch previews; do not touch app code without explicit approval.
- After approval, apply patches in a branch/PR and run tests before merge.

## Operating Policy (Required)
- See `codex/POLICY.md` for authoritative operating rules:
  - Read-only advisory by default; write only with explicit “Approved” and only inside `codex/`.
  - Safe reads only; no installs or destructive commands.
  - Startup routine: read `codex/previous-sessions/RESUME.md` and recap Next Steps.
  - Supported chat commands include “Resume from resume.md”, “Refresh readme.md”, “Refresh resume.md”, and “End session”.
