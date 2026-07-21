# Deployment Contracts

## Supported Modes

- Windows development:
  `node scripts/compose-up.cjs`
- Linux production:
  `node scripts/compose-up.cjs`
- Optional monitoring:
  `docker compose --profile monitoring up -d monitor`

The wrapper creates `.env` from `.env.example`, generates required local
secrets, and appends new settings without replacing operator
values. `docker compose up -d --build` does not run the generator. Prepare
`.env` before using Compose directly because Compose resolves required
variables before it starts a container.

## Authenticator Email Delivery

Only the `auth` container receives `APP_PUBLIC_URL` and the `SMTP_*` values.
Enrollment notices automatically use the browser-facing gateway origin from
the administrator's request, including a private IP and custom port.
`APP_PUBLIC_URL` remains an optional fallback for unusual proxy
deployments. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, and `SMTP_FROM`
to enable mail. Relays that require authentication also need both `SMTP_USER`
and `SMTP_PASSWORD`.

Auth starts when SMTP is absent. An MFA enable or reset remains pending when
delivery fails, and an administrator can resend the notice after fixing the
mail settings. Enrollment messages contain the setup page URL without a QR
secret, OTP, challenge token, or SMTP credential.

The core stack starts the Linux auth-log and Docker log collectors by default.
If a collector cannot read a source, the vulnerability service remains healthy
and the corresponding Log Monitor endpoint reports that source as unavailable.

## Network Boundaries

| Network | Members and purpose |
| --- | --- |
| `edge` | Gateway and HTTP applications; provides normal outbound access |
| `app-data` | Vulnerability API, worker, app database, and legacy auth import |
| `auth-data` | Authentication service and authentication database |
| `observability` | Vulnerability API and host-log collectors |

The two data networks and the observability network are internal. Databases are
not attached to the edge network.

Protected services call `auth` directly for token introspection. The
gateway does not expose the introspection endpoint publicly.

## Stable Names and Storage

Compose service names and public routes are compatibility contracts. Image tags
are controlled by `IMAGE_NAMESPACE` and `IMAGE_TAG`.

Persistent volumes use `VOLUME_NAMESPACE`. Existing environments that omit the
variable retain the legacy `defectdojo-viewer_*` names. New environments should
set `VOLUME_NAMESPACE=internal-security-middleware`. Changing this variable does
not migrate data; use the documented volume migration procedure first.

Docs content uses the namespaced `docs-data` volume in the single Compose
model. The image keeps shipped defaults under `/app/docs-default`; startup
seeding copies missing files, updates files that still match the previous
shipped hash, and preserves administrator-edited files.
