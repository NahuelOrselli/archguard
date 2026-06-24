# CI baseline rollout (Day 0 -> Day 1)

Use this guide to adopt Archguard in repositories with existing architecture drift.

## Day 0: Start without blocking legacy issues

1. Generate a baseline from current findings:

```bash
npx @nahuelorselli/archguard baseline create --out .archguard-baseline.json
```

2. Commit `.archguard-baseline.json`.

3. Run check in CI with baseline enabled:

```bash
npx @nahuelorselli/archguard check --baseline .archguard-baseline.json
```

Result:

- Existing violations are ignored.
- New violations introduced by PRs still fail the check.

## Day 1: Keep tightening

- Re-generate baseline only when you intentionally accept current debt.
- Gradually fix historical violations and refresh baseline less often.
- Move to strict mode (no baseline) when violations reach zero.

## Suggested rollout policy

- Week 1: baseline mode enabled, collect false positives.
- Week 2-3: reduce baseline size by fixing highest-risk violations.
- Week 4: attempt strict mode in at least one repository.

## Practical tips

- Keep baseline file at repo root: `.archguard-baseline.json`
- Treat baseline changes like policy changes: review them in PR.
- Pair baseline mode with protected branches and required checks.
