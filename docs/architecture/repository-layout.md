# Repository Layout and Ownership

The repository is organized by deployable application first, then by shared
capability. Runtime service names, public routes, ports, API payloads, image
names, and volume names are independent of these source paths.

```text
apps/
  gateway/
  auth/{web,server}/
  hub/
  vulnerability/{web,server,workers,collectors}/
  wazuh/
  docs/{web,server,content}/
packages/
  ui/
  auth-client/
  time/
  test-utils/
infra/compose/
  compose.yml
  compose.dev.yml
  compose.observability.yml
  compose.prod.yml
scripts/
docs/architecture/
```

## Boundaries

- `apps/*` own deployable behavior and remain independently installable.
- `web` contains browser entry points and feature code; `server` contains HTTP
  APIs and persistence adapters; `workers` contains non-HTTP processes.
- `apps/docs/content` is immutable shipped documentation. Production writes go
  to the Docs volume; development can bind this directory explicitly.
- `packages/*` contain dependency-light code shared by multiple applications.
  Existing app-local modules may remain as compatibility facades while imports
  migrate.
- `infra/compose/compose.yml` is the portable core. Development, production
  hardening, and host observability are explicit overlays.
- Root `docker-compose.yml` and `docker-compose.dev.yml` are compatibility
  entry points only. New automation must use the canonical files under
  `infra/compose`.

## Change Rules

1. Do not rename Compose services when moving source.
2. Do not combine source-layout changes with volume-namespace migrations.
3. Add shared behavior to a package only after its app-specific contracts are
   covered by tests.
4. Validate every Compose overlay combination and every application build.
