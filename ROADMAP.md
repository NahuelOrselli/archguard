# Archguard Roadmap

This roadmap defines the execution path to make Archguard a trusted, PR-first architecture guardrail for engineering teams.

## Product principles

- PR-first value: architecture feedback must happen in pull requests.
- Deterministic core: rules and detection logic should not depend on LLMs.
- Low-noise by default: fewer rules, higher signal.
- Fast setup: first useful result in under 5 minutes.
- Explicit governance: ownership, waivers, and policy severity should be auditable.

## Status legend

- `completed` done and merged
- `in_progress` currently being built
- `planned` committed roadmap item
- `exploring` research only, not committed yet

---

## v0.2 - Foundation DX (in_progress)

Goal: make onboarding and day-1 usage excellent.

- [ ] Interactive `archguard init` wizard
  - Detect repo shape (`monorepo` or `single-app`)
  - Ask service roots (`apps/*`, `services/*`, `src`, custom)
  - Assign service types (`frontend`, `backend`, `worker`)
  - Choose rules preset (`minimal`, `recommended`, `strict`)
- [ ] Non-interactive init modes
  - `archguard init --yes`
  - `archguard init --preset <name> --root <path>`
- [ ] `archguard doctor` command
  - Validate config file, paths, duplicated IDs, and malformed rules
- [ ] Config polish
  - Clear validation errors with actionable fix hints
  - Stable schema docs for `.archguard.yaml`
- [ ] Better PR output readability
  - Group violations by service and by rule

Exit criteria:

- Setup in a new repo in < 5 minutes
- Most teams can run without editing config manually on first run

---

## v0.3 - Rule Engine Hardening (planned)

Goal: increase rule coverage while preserving precision.

- [ ] Rule packs (`core`, `ownership`, `boundaries`)
- [ ] New deterministic rules
  - `no_cross_service_internal_imports`
  - `require_service_type`
  - `require_declared_dependencies`
  - `no_frontend_env_secrets` (pattern-based)
- [ ] Rule severity controls (`off`, `warn`, `error`)
- [ ] Waivers with expiration
  - `reason`, `owner`, `expires_at`

Exit criteria:

- 5 to 8 stable rules with low false-positive rate in pilot repos

---

## v0.4 - Team Integrations (planned)

Goal: make Archguard usable across team workflows and CI setups.

- [ ] CI templates
  - GitHub Actions hardening
  - GitLab CI baseline template
- [ ] Machine-readable outputs
  - Stable JSON output
  - Optional SARIF output
- [ ] Baseline mode
  - Fail on new violations only
- [ ] PR comments with architecture-change summaries

Exit criteria:

- Teams can adopt incrementally without blocking on legacy violations

---

## v0.5 - Multi-stack Expansion (planned)

Goal: expand beyond Node/TypeScript with analyzer adapters.

- [ ] Analyzer architecture (`analyzers/*`)
- [ ] Python analyzer (imports + dependency signals)
- [ ] Go analyzer (imports + package boundaries)
- [ ] Shared model remains `.archguard.yaml`

Exit criteria:

- Core rules working in 3 languages with consistent output shape

---

## v1.0 - Reliability and Governance (planned)

Goal: production-ready guardrail with stable contract.

- [ ] Semver stability and migration guides
- [ ] Performance optimization for large repos
- [ ] Full fixture-based test suite per rule
- [ ] Rollout playbook for organizations

Exit criteria:

- Reliable rollout in multi-team environments with predictable noise levels

---

## Explicit non-goals (for now)

- Canvas-first architecture editor as core product
- Full app/infra code generation as core product
- LLM-dependent rule detection logic
- Heavy UI before CLI + CI maturity

---

## Success metrics

- Time to first useful signal in CI
- Violations found per PR that developers agree are valid
- False-positive reports per rule
- Repositories with check enforced on protected branches
- Weekly active repos running Archguard in CI
