# Deployment Contracts

## Supported Modes

- Windows development:
  `docker compose --env-file .env -f infra/compose/compose.yml -f infra/compose/compose.dev.yml up -d --build`
- Linux production with host logs:
  `docker compose --env-file .env -f infra/compose/compose.yml -f infra/compose/compose.prod.yml -f infra/compose/compose.observability.yml --profile host-logs up -d --build`
- Optional monitoring:
  `docker compose --env-file .env -f infra/compose/compose.yml -f infra/compose/compose.observability.yml --profile monitoring up -d monitor`

The core stack does not require either optional profile. If a collector is not
running, the vulnerability service remains healthy and the corresponding Log
Monitor endpoint reports that source as unavailable.

## Network Boundaries

| Network | Members and purpose |
| --- | --- |
| `edge` | Gateway and HTTP applications; provides normal outbound access |
| `app-data` | Vulnerability API, worker, app database, and legacy auth import |
| `auth-data` | Authentication service and authentication database |
| `observability` | Vulnerability API and host-log collectors |

The two data networks and the observability network are internal. Databases are
not attached to the edge network.

Protected services call `auth-primary` directly for token introspection. The
gateway does not expose the introspection endpoint publicly.

## Stable Names and Storage

Compose service names and public routes are compatibility contracts. Image tags
are controlled by `IMAGE_NAMESPACE` and `IMAGE_TAG`.

Persistent volumes use `VOLUME_NAMESPACE`. Existing environments that omit the
variable retain the legacy `defectdojo-viewer_*` names. New environments should
set `VOLUME_NAMESPACE=internal-security-middleware`. Changing this variable does
not migrate data; use the documented volume migration procedure first.

Production Docs content uses the namespaced `docs-data` volume. The image keeps
shipped defaults under `/app/docs-default`; startup seeding copies missing
files, updates files that still match the previous shipped hash, and preserves
administrator-edited files. Windows development replaces that volume with the
repository bind mount through `infra/compose/compose.dev.yml`.
