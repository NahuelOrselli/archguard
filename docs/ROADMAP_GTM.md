# Archguard Roadmap (User-facing)

This is the public rollout plan focused on user value and adoption.

## What Archguard is now

- PR-first architecture checks for Node/TypeScript repositories
- Deterministic rules with actionable PR comments
- Fast start with `init` and CI integration

## Next milestones

## Milestone 1: Better onboarding

Status: `in_progress`

Progress update:

- [x] Interactive setup wizard
- [x] Presets (`minimal`, `recommended`, `strict`)
- [x] `doctor` command and stronger config diagnostics

What users get:

- Interactive setup wizard
- Sensible presets (`minimal`, `recommended`, `strict`)
- Clear config validation with fix suggestions

Success signal:

- New teams get first useful signal in under 5 minutes

## Milestone 2: Stronger rule packs

Status: `in_progress`

What changes based on user feedback:

- [x] Customizable detector inputs from config (DB client packages)
- [ ] Extended detector inputs from config (import patterns)
- [x] First rule template (`no_path_imports`) for config-driven guardrails
- [x] Additional rule templates for broader policy coverage (`allowed_service_dependencies`)

What users get:

- More boundary and ownership checks
- Rule severity control (`off`, `warn`, `error`)
- Temporary waivers with owner and expiration
- Config-driven customization for common rule families

Success signal:

- Teams keep checks enabled because noise stays low

## Milestone 3: Team workflow fit

Status: `in_progress`

Progress update:

- [x] Baseline mode (fail only on new violations)

What users get:

- Baseline mode (fail only on new violations)
- JSON and SARIF outputs
- Better PR summaries of architecture changes

Success signal:

- Teams can adopt without blocking on legacy debt

## Milestone 4: Language expansion

What users get:

- Python and Go analyzers with the same model
- Consistent output format across stacks

Success signal:

- Multi-language repos use one architecture policy surface

## Milestone 5: v1 reliability

What users get:

- Stable semver contract
- Migration guides
- Improved performance in large repositories

Success signal:

- Predictable behavior and low maintenance overhead

## What we are intentionally not doing yet

- Canvas-first editor as the core product
- Full app/infra generation as the core product
- LLM-dependent detection for core rules
