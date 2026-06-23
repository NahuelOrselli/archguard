# archguard MVP (PR-first)

Minimal Architecture-as-Code demo focused on one rule running in GitHub Actions.

## What this MVP does

- Reads architecture model from `.arch.yaml`
- Maps service paths in the repo
- Enforces one rule: `no_frontend_db_access`
- Posts a report in pull requests
- Fails CI when the rule is violated

## Rule demo

If any file inside a frontend service imports one of these DB clients, CI fails:

- `@prisma/client`
- `pg`
- `mysql2`
- `mongodb`

## Local run

```bash
npm install
npm run archguard
```

Changed files mode:

```bash
npm run archguard:changed
```

## GitHub Actions run

Workflow file: `.github/workflows/archguard.yml`

On each PR, the workflow:

1. runs archguard on changed files
2. writes `archguard-report.md`
3. comments the report in the PR
4. fails the job if violations exist

## End-to-end demo scenario

### PR that should fail

1. Edit `apps/web/src/lib/http.ts`
2. Add:

```ts
import { PrismaClient } from "@prisma/client";
```

3. Open PR
4. Expected: PR comment with violation + failed check

### PR that should pass

1. Remove DB client import from frontend
2. Keep DB access in `apps/api`
3. Push update
4. Expected: passing check and clean report
