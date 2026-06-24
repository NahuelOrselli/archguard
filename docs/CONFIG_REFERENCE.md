# `.archguard.yaml` reference (v0.2)

Minimal schema used by Archguard today.

## Top-level

```yaml
version: 0
services: []
resources: []
rules: {}
detectors: {}
rule_templates: []
```

## `services[]`

Required fields:

- `id` (string, unique)
- `path` (string, repo-relative)
- `type` (`frontend`, `backend`, `worker`)
- `owner` (string)

## `rules`

Built-in rule ids:

- `no_frontend_db_access`
- `require_owner`

Severity values:

- `off`
- `warn`
- `error`

## `detectors`

Supported detector configuration:

```yaml
detectors:
  db_client_packages_mode: extend # extend | replace
  db_client_packages:
    - drizzle-orm
    - knex
```

## `rule_templates[]`

### `no_path_imports`

```yaml
rule_templates:
  - id: no-web-imports-from-api
    type: no_path_imports
    from: apps/web/**
    deny_import: apps/api/**
    severity: error
```

### `allowed_service_dependencies`

```yaml
rule_templates:
  - id: web-allowed-deps
    type: allowed_service_dependencies
    service: web
    allow:
      - apps/shared/**
      - apps/contracts/**
    severity: error
```
