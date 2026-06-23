# Hub User Guide

Use this guide to prepare the environment, start the system, understand access roles, sign in to the Internal Security Middleware Hub, choose a workspace, and manage Hub users.

## Contents

1. [Prerequisites](#prerequisites)
2. [What the System Does](#what-the-system-does)
3. [Roles and Access](#roles-and-access)
4. [Start the System](#start-the-system)
5. [Default Credentials and Security](#default-credentials-and-security)
6. [Overall User Flow](#overall-user-flow)
7. [Log In and Use the Hub](#log-in-and-use-the-hub)
8. [What to Do After First Login](#what-to-do-after-first-login)
9. [Manage Hub Users](#manage-hub-users)

## Prerequisites

Before starting the system, complete the external setup outlined in the [Quick Start Guide](../quick-start.md) guide.

You will need:
- Docker Desktop (Windows/Mac) or Docker Engine with Compose V2 (Linux)
- A modern web browser (Chrome, Firefox, Edge, or Safari)
- The project source code cloned to your local machine
- (For DefectDojo integration) A DefectDojo instance with an API v2 token
- (For Redmine integration) A Redmine instance with REST API access enabled and an API key

## What the System Does

The Internal Security Middleware Hub is the entry point for internal security tools.

- **Hub** handles sign-in, single sign-on, app switching, and user administration.
- **DefectDojo Viewer** pulls DefectDojo findings, groups duplicate/noisy results into compacted findings, tracks Redmine ticket status, and manages mitigation review.
- **Wazuh Viewer** is a static SIEM-style mockup for alerts, incidents, agents, and Wazuh settings preview.

### Architecture Overview
The system runs six Docker containers orchestrated by Docker Compose:

| Service | Purpose | Internal Port |
|---|---|---|
| **gateway** | Nginx reverse proxy, routes all browser traffic | 80 |
| **hub** | Authentication, user management, workspace switcher | 3000 |
| **defectdojo** | DefectDojo Viewer — vulnerability findings and Redmine workflows | 3001 |
| **wazuh** | Wazuh Viewer — SIEM mockup interface | 3002 |
| **docs** | Documentation reader service | 3003 |
| **db** | PostgreSQL — application data (findings, config, sync state) | 5432 |
| **auth-db** | PostgreSQL — authentication data (users, sessions, audit) | 5432 |

All services are accessed through the gateway on a single port (default: 8080).

## Roles and Access

There are two main roles.

| Role | Can do |
| --- | --- |
| **Admin** | Manage users, configure integrations, run Sync Findings, rebuild Redmine status, clear local data, view sync history, and process mitigation reviews. |
| **Viewer** | View dashboards, findings, products, engagements, Redmine status, and linked Redmine issues. |

Viewer accounts can be restricted to specific product names. Admin accounts have full product access.

## Start the System

Use these steps to configure and run the application locally with Docker Compose.

### Step 1: Copy the Environment File
Open a terminal in the project root and copy the example environment file:
```powershell
Copy-Item .env.example .env
```

### Step 2: Configure Environment Variables
Open `.env` in a text editor and set values for each variable:

| Variable | Purpose | What Happens If Wrong | Example |
|---|---|---|---|
| `GATEWAY_PORT` | The port you use in the browser to access the system | You'll navigate to the wrong port | `8080` |
| `PG_DB` | Database name for DefectDojo Viewer data | Application data storage fails | `defectdojo_viewer` |
| `PG_USER` | Database username for DefectDojo Viewer | Application data storage fails | `defectdojo` |
| `PG_PASSWORD` | Database password for DefectDojo Viewer data | Application database connection fails | Use a strong random password |
| `AUTH_PG_DB` | Database name for authentication data | Login and user management fails | `middleware_auth` |
| `AUTH_PG_USER` | Database username for authentication data | Login and user management fails | `middleware_auth` |
| `AUTH_PG_PASSWORD` | Database password for authentication data | Login and user management fails | Use a strong random password |
| `JWT_SECRET` | Secret key for signing authentication tokens. Must be the same across Hub and DefectDojo Viewer. | Authentication between services breaks — users may be logged out randomly or unable to access workspaces | Use a random string of at least 32 characters |
| `AUTH_SERVICE_TOKEN` | Internal service-to-service authentication token. Used by DefectDojo Viewer to validate sessions with Hub. | DefectDojo Viewer cannot verify user sessions, resulting in 401 errors | Use a random string |

> [!CAUTION]
> PostgreSQL stores credentials in Docker volumes on first startup. If you change `PG_PASSWORD`, `AUTH_PG_PASSWORD`, `PG_USER`, or `AUTH_PG_USER` AFTER the system has already run once, the old credentials remain active in the volumes. To apply new credentials, you must delete the volumes:
> ```powershell
> docker compose down -v
> docker compose up -d --build
> ```
> This deletes ALL data including findings, users, and configuration.

### Step 3: Start the Containers
```powershell
docker compose up -d --build
```

### Step 4: Verify All Services Are Running
```powershell
docker compose ps
```
You should see all seven containers (`gateway`, `hub`, `defectdojo`, `wazuh`, `docs`, `db`, `auth-db`) with status "Up" or "running".

### Step 5: Verify Health Endpoints
```powershell
curl http://localhost:8080/api/health
curl http://localhost:8080/defectdojo/api/health
```
Both should return JSON with health status information.

### Step 6: Open the Hub
Open `http://localhost:8080` in your browser. You should see the login page.
If you changed `GATEWAY_PORT` in `.env`, use that port instead of 8080.

## Default Credentials and Security

| Field | Value |
| --- | --- |
| Username | `admin` |
| Password | `admin` |

> [!WARNING]
> **Change the default password immediately after first login.** The default `admin`/`admin` credentials are intended for initial setup only. In any shared or production environment, use a strong password.

Security hardening checklist:
1. Change the default admin password
2. Set a strong `JWT_SECRET` (at least 32 random characters)
3. Set a strong `AUTH_SERVICE_TOKEN`
4. Do not expose `GATEWAY_PORT` to the internet without TLS/HTTPS
5. Set strong, unique `PG_PASSWORD` and `AUTH_PG_PASSWORD` values

## Overall User Flow

### For an Admin

1. Start the stack and log in to the Hub.
2. Open **User Management** and create the required users.
3. Open **DefectDojo Viewer**.
4. Go to **Settings**.
5. Configure **Connection** for DefectDojo and Redmine.
6. Configure **Redmine Status** values and priority mappings.
7. Return to **Dashboard**.
8. Click **Sync Findings**.
9. Review the dashboard, findings table, Sync History, and Mitigation Review queue.

### For a Viewer

1. Log in to the Hub.
2. Open **DefectDojo Viewer**.
3. Review **Dashboard** summary cards.
4. Use search, severity, Redmine status, company, and engagement filters in the findings table.
5. Open a finding row to review description, impact, endpoints, CVEs, CWEs, and mitigation.
6. Open linked Redmine issues when a ticket exists.

## Log In and Use the Hub

The Hub is the main app selector.

### Log In

1. Open `http://localhost:8080`.
2. Enter your **Username**.
3. Enter your **Password**.
4. Click **Sign In**.
5. After login, the Hub shows **Select a workspace**.

### Choose a Workspace

The Hub shows app cards.

| Card | Use it for |
| --- | --- |
| **DefectDojo Viewer** | Vulnerability findings, Redmine ticket workflow, sync history, mitigation review, and settings. |
| **Wazuh Viewer** | Mock SIEM dashboards, alerts, incidents, agents, and Wazuh settings preview. |

Each card shows a health state:

- **Healthy** means the workspace is reachable.
- **Offline** means the workspace did not respond to the Hub health check.

To open a workspace:

1. Click the app card.
2. Wait for the selected app to load.
3. Use **Back to Hub** inside the workspace when you want to return.

### Sign Out

1. Click **Sign Out** in the Hub top bar, or **Logout/Sign Out** inside a workspace.
2. The browser session token is removed.
3. You are returned to the Hub login page.

## What to Do After First Login

After logging in for the first time, follow this decision path:

1. **Change the default password** — Go to User Management, edit the admin user, set a strong password.
2. **Create user accounts** — Add admin and viewer accounts for your team.
3. **Configure DefectDojo integration** — Open DefectDojo Viewer → Settings → Connection → enter your DefectDojo URL and API key.
4. **Configure Redmine integration** — In the same Connection tab, enter your Redmine URL and API key.
5. **Configure Redmine Status mapping** — Go to Settings → Redmine Status → set status IDs and priority IDs (or leave blank for auto-resolve).
6. **Run your first sync** — Return to Dashboard → click Sync Findings → use default filters → click Pull & Sync.
7. **Verify results** — Check that the dashboard shows finding counts and severity distribution.

## Manage Hub Users

Admins can manage Hub identities from the Hub.

### Open User Management

1. Log in as an admin.
2. On the Hub page, find the **Administration** section.
3. Click **User Management**.

### Add a User

1. Click **Add User**.
2. Enter **Username**.
3. Enter **Email** if available.
4. Enter **Password**.
5. Choose **Role**:
   - **Viewer** for read-only/restricted use.
   - **Admin** for full administration.
6. Choose **Status**:
   - **Active** allows sign-in.
   - **Suspended** blocks active use.
7. For Viewer accounts, enter **Allowed Products** as comma-separated product names when access should be restricted.
8. Click **Save User**.

### Edit a User

1. Find the user in the table.
2. Use the search box or filters for role, presence, account, or access.
3. Click the pencil icon.
4. Update email, role, status, or product access.
5. Click **Save User**.

### Reset a Password

1. Find the user in the table.
2. Click the key icon.
3. Enter the new password.
4. Click **Save User** or **Save Password**.

### Delete a User

1. Find the user in the table.
2. Click the trash icon.
3. Confirm the browser prompt.

You cannot delete your own active user from the Hub user table.
