# Adoption Checklist (First 10 installs)

Use this checklist to track real-world onboarding quality before expanding feature scope.

## Target

- 10 independent repositories running Archguard in CI
- At least 5 with required check enabled on protected branches

## Per-repo checklist

- [ ] Repo URL recorded
- [ ] Install command used (`npx` / `pnpm dlx` / `bunx`)
- [ ] `archguard init` completed
- [ ] `archguard doctor` completed with 0 errors
- [ ] `archguard check` completed in CI
- [ ] PR comment appears correctly in pull request
- [ ] Team confirms at least one useful finding
- [ ] Any false positive captured as issue

## Signals to monitor

- Time to first useful signal (minutes)
- Number of setup retries needed
- Most common onboarding blockers
- Most common false positives

## Exit criteria for next scope expansion

- Median setup time < 5 minutes
- False positive feedback low and manageable
- Teams keep the check enabled after first week
