# Deployment Contracts

## Supported Modes

- Windows development:
  `docker compose up -d --build`
- Linux production:
  `docker compose up -d --build`
- Optional monitoring:
  `docker compose --profile monitoring up -d monitor`

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

## Runtime Email Delivery

SMTP is configured by an administrator at **Hub → System Settings → Email
Delivery** and is stored encrypted in Auth storage. Updating SMTP does not
require rebuilding or recreating containers. Unauthenticated Postfix on port 25
is supported; Plain mode is allowed with an in-product warning because messages,
including automatically queued temporary-password mail, are not encrypted in transit.

Auth writes MFA setup and temporary-password messages to a durable outbox.
The worker retries transient failures after 1, 5, 15, and 60 minutes, recovers
stale leases after restart, and never holds an administrator HTTP request open
while SMTP connects. Setup links are derived from the validated gateway-facing
host, protocol, and port of the request that queued the message. Authenticator
invitations use `/login/mfa-setup#invite=...`; placing the token in the fragment
keeps it out of gateway request logs. Each invitation is single-use, expires
after 24 hours, and can bootstrap enrollment without a Middleware session or
the user's current password. Administrators can resend pending setup mail.
Successful confirmation revokes all of the user's sessions and directs them to
sign in again with TOTP.

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
