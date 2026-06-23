# MVP plan - archguard (PR-first)

## Goal

Deliver a minimal Architecture-as-Code demo that runs in GitHub Actions and blocks PRs when a frontend directly imports DB clients.

## Scope (strict)

- One repository example (this repo).
- One rule only: `no_frontend_db_access`.
- One config file: `.arch.yaml`.
- One CLI command: `archguard check`.
- One CI workflow for `pull_request`.

## Deliverables

1. Repo skeleton with `apps/web` and `apps/api`.
2. `.arch.yaml` with frontend/backend/resources and the demo rule.
3. `tools/archguard` CLI that:
   - parses `.arch.yaml`
   - optionally reads changed files from git diff
   - detects DB imports in frontend service paths
   - prints markdown + summary
   - exits non-zero on rule violations
4. GitHub Actions workflow that:
   - runs archguard on each PR
   - posts markdown comment in PR
   - fails workflow on violations
5. README with setup and demo scenario.

## Burn down

- [x] Plan file created
- [x] Repo example skeleton
- [x] Rule engine and CLI command
- [x] GitHub Actions integration
- [x] Docs and local verification
- [ ] Validate workflow run in a real GitHub PR
