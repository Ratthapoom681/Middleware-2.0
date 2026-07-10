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
docker-compose.yml
scripts/
docs/architecture/
```

## Boundaries

- `apps/*` own deployable behavior and remain independently installable.
- `web` contains browser entry points and feature code; `server` contains HTTP
  APIs and persistence adapters; `workers` contains non-HTTP processes.
- `apps/docs/content` is immutable shipped documentation. Runtime writes go to
  the Docs volume.
- `packages/*` contain dependency-light code shared by multiple applications.
  Existing app-local modules may remain as compatibility facades while imports
  migrate.
- Root `docker-compose.yml` is the single canonical Compose model. Optional
  Linux host-log collectors and Glances monitoring are controlled with Compose
  profiles inside that file.

## Change Rules

1. Do not rename Compose services when moving source.
2. Do not combine source-layout changes with volume-namespace migrations.
3. Add shared behavior to a package only after its app-specific contracts are
   covered by tests.
4. Validate the default Compose model, optional profiles, and every application build.
