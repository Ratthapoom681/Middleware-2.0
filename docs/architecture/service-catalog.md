# Service Catalog

Runtime service names are stable operational contracts. Directory and product
names may be more descriptive, but scripts and monitoring should use the
Compose names below.

| Compose service | Source directory | Public route | Responsibility |
| --- | --- | --- | --- |
| `gateway` | `apps/gateway` | `/` and all routed paths | Edge routing and degraded Hub page |
| `hub` | `apps/hub` | `/` | Workspace portal and user-management UI |
| `auth` | `apps/auth` | `/login/`, `/api/auth/*`, `/api/users*` | Identity, sessions, and authorization |
| `defectdojo` | `apps/vulnerability` | `/defectdojo/` | Vulnerability and Redmine workflows |
| `auto-sync-status` | `apps/vulnerability/workers` | None | Background Redmine status worker |
| `wazuh` | `apps/wazuh` | `/wazuh/` | Static SIEM viewer |
| `docs` | `apps/docs` | `/docs/` | Documentation reader and editor |
| `linux-log-collector` | `apps/vulnerability/collectors/linux-auth-log` | None | Linux authentication log ingestion |
| `docker-log-collector` | `apps/vulnerability/collectors/docker-log` | None | Docker event-log ingestion |
| `defectdojo_db` | Upstream PostgreSQL image | None | Vulnerability workflow storage |
| `auth-db` | Upstream PostgreSQL image | None | Authentication storage |
| `monitor` | Upstream Glances image | Localhost-only port | Host and container monitoring |

The public product name “DefectDojo Viewer,” Compose service name `defectdojo`,
and `/defectdojo/` route remain unchanged.
