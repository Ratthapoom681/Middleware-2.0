# Service Catalog

Runtime service names are stable operational contracts. Directory and product
names may be more descriptive, but scripts and monitoring should use the
Compose names below.

| Compose service | Source directory | Public route | Responsibility |
| --- | --- | --- | --- |
| `gateway` | `gateway-service` | `/` and all routed paths | Edge routing and degraded Hub page |
| `hub` | `hub-service` | `/` | Workspace portal and user-management UI |
| `auth-primary` | `auth-service` | `/login/`, `/api/auth/*`, `/api/users*` | Identity, sessions, and authorization |
| `defectdojo` | `vulnerability-service` | `/defectdojo/` | Vulnerability and Redmine workflows |
| `auto-sync-status` | `vulnerability-service` | None | Background Redmine status worker |
| `wazuh` | `wazuh-service` | `/wazuh/` | Static SIEM viewer |
| `docs` | `docs-service` | `/docs/` | Documentation reader and editor |
| `linux-log-collector` | `vulnerability-service/collectors/linux-auth-log` | None | Linux authentication log ingestion |
| `docker-log-collector` | `vulnerability-service/collectors/docker-log` | None | Docker event-log ingestion |
| `db` | Upstream PostgreSQL image | None | Vulnerability workflow storage |
| `auth-db` | Upstream PostgreSQL image | None | Authentication storage |
| `monitor` | Upstream Glances image | Localhost-only port | Host and container monitoring |

The public product name “DefectDojo Viewer” and its `/defectdojo/` route remain
unchanged even though its source directory is named `vulnerability-service`.
