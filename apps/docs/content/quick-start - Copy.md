# Quick Start Guide

Get the Internal Security Middleware Hub running and syncing your first DefectDojo findings into Redmine tickets. Follow each section in order.

## Contents

1. [What You Need Before Starting](#1-what-you-need-before-starting)
2. [Prepare DefectDojo (External)](#2-prepare-defectdojo-external)
3. [Prepare Redmine (External)](#3-prepare-redmine-external)
4. [Install and Start the Middleware](#4-install-and-start-the-middleware)
5. [Log In and Change the Default Password](#5-log-in-and-change-the-default-password)
6. [Configure DefectDojo Connection](#6-configure-defectdojo-connection)
7. [Configure Redmine Connection](#7-configure-redmine-connection)
8. [Configure Redmine Priority and Status Mapping](#8-configure-redmine-priority-and-status-mapping)
9. [Run Your First Sync](#9-run-your-first-sync)
10. [Verify Everything Works](#10-verify-everything-works)
11. [What to Do Next](#11-what-to-do-next)

---

## 1. What You Need Before Starting

Before you touch any configuration file, make sure you have all of these ready:

| Requirement | Details |
|---|---|
| **Docker** | Docker Desktop (Windows/Mac) or Docker Engine with Compose V2 (Linux) |
| **Web Browser** | Any modern browser (Chrome, Firefox, Edge) |
| **DefectDojo Instance** | A running DefectDojo v2.x with at least one product containing findings |
| **Redmine Instance** | A running Redmine instance with admin or privileged user access |
| **Network Access** | The machine running Docker must be able to reach both DefectDojo and Redmine over the network |

### Network and Connectivity Requirements

The middleware runs inside Docker containers. The Docker host machine must be able to reach both your DefectDojo and Redmine instances over the network.

**DefectDojo and Redmine on the same network**
Use the standard hostnames or IP addresses. Example:
- DefectDojo URL: `https://defectdojo.internal.company.com`
- Redmine URL: `https://redmine.internal.company.com`

**DefectDojo or Redmine on localhost**
If either service runs on the same machine as Docker:
- Do NOT use `localhost` or `127.0.0.1` — these resolve to the container, not the host.
- On Docker Desktop (Windows/Mac), use `http://host.docker.internal:PORT`
- On Linux Docker, use the host's actual IP address or configure Docker network mode.

**Behind a corporate proxy or VPN**
Configure Docker to use the corporate proxy. See Docker documentation for proxy configuration.

**Verify connectivity from inside Docker:**
```powershell
docker compose exec defectdojo wget -qO- --header="Authorization: Token YOUR_KEY" https://defectdojo.example.com/api/v2/findings/?limit=1
```

---

## 2. Prepare DefectDojo (External)

You need one thing from DefectDojo: an **API key**.

### Steps

1. Log in to your DefectDojo instance as a user who has visibility to the products/findings you want to sync.
2. Click your **username** in the top-right corner.
3. Click **API v2 Key** (or navigate directly to `/api/key-v2`).
4. Copy the API key shown, or click **Regenerate** to create a new one.
5. **Save this key** — you will paste it into the middleware settings later.

### Quick Verification

Test the key from a terminal on the Docker host:

```bash
curl -H "Authorization: Token YOUR_API_KEY" https://defectdojo.example.com/api/v2/findings/?limit=1
```

If it returns JSON findings data, the key works.

### Technical Details

- The middleware sends requests using the header: `Authorization: Token <your-api-key>`
- The middleware **only reads** from DefectDojo — it never creates, modifies, or deletes any data in DefectDojo.
- The API user needs read access to: findings, tests, engagements, products, and endpoints.
- Endpoints called: `GET /api/v2/findings/`, `GET /api/v2/tests/{id}/`, `GET /api/v2/engagements/{id}/`, `GET /api/v2/products/{id}/`, `GET /api/v2/endpoints/`

### URL Format

- Use the base URL only, e.g., `https://defectdojo.example.com`
- Do NOT include `/api/v2/` at the end
- Do NOT include a trailing slash

### Common Mistakes

- Using the wrong URL format (including `/api/v2/`)
- API key expired or regenerated
- API user does not have visibility to the products being synced
- Network firewall blocking access from Docker host

---

## 3. Prepare Redmine (External)

Redmine requires more setup because the middleware both **reads and writes** to it (creating and updating tickets).

### Step 3.1 — Enable the REST API

1. Log in to Redmine **as an administrator**.
2. Go to **Administration → Settings**.
3. Click the **API** tab.
4. Check **"Enable REST web service"**.
5. Click **Save**.

> [!WARNING]
> If the REST API is not enabled, ALL API requests from the middleware will fail with 403 Forbidden errors, regardless of your API key.

### Step 3.2 — Create or Choose an API User

The middleware needs a Redmine user with these permissions:

| Permission | Required For |
|---|---|
| View Issues | Searching existing tickets |
| Create Issues | Creating new vulnerability tickets |
| Edit Issues | Updating ticket priority, description, and adding notes |
| View Issue Statuses | Resolving status IDs by name |
| Create Projects *(optional)* | Only if you want auto-routing by product name |

> [!TIP]
> The simplest approach is to use a Redmine account with the **Administrator** role. This guarantees all required permissions are available.

### Step 3.3 — Get the API Key

1. Log in to Redmine as the API user.
2. Go to **My Account** (click your username → My account, or navigate to `/my/account`).
3. In the right sidebar, find **"API access key"**.
4. Click **Show** to reveal, or **Reset** to generate a new key.
5. Copy the API key. **Save this key** — you will paste it into the middleware settings later.

### Quick Verification

```bash
curl -H "X-Redmine-API-Key: YOUR_API_KEY" https://redmine.example.com/issue_statuses.json
```

If it returns a JSON array of statuses, the key works.

### Technical Details

- The middleware sends requests using the header: `X-Redmine-API-Key: <your-api-key>`
- The middleware **reads and writes** to Redmine — it creates issues, updates issues, and can create projects.
- Endpoints called:
  - `GET /projects/{identifier}.json` — look up projects
  - `GET /projects.json` — list/search projects
  - `POST /projects.json` — create projects (if auto-routing)
  - `GET /issues.json` — search for existing issues
  - `POST /issues.json` — create new issues
  - `PUT /issues/{id}.json` — update existing issues
  - `GET /issues/{id}.json` — fetch issue status
  - `GET /issue_statuses.json` — list all statuses

### URL Format

- Use the base URL only, e.g., `https://redmine.example.com`
- Do NOT include a trailing slash

### Common Mistakes

- REST API not enabled in Redmine admin settings
- User lacks required project-level permissions
- Wrong URL format

### Step 3.4 — Find Your Redmine Project Identifier

Decide where the middleware should create tickets:

**Option A: Single project (recommended for small teams)**
Navigate to your target project in Redmine and look at the URL:

```
https://redmine.example.com/projects/my-security-project
                                        ^^^^^^^^^^^^^^^^^^^
                                        This is the identifier
```

> [!CAUTION]
> The Redmine Project ID field requires a **string identifier** (like `security-findings`), NOT a numeric ID (like `42`). If you enter a number, the system will reject it with an error: *"Use the Redmine project identifier, not the numeric Redmine project id."*

**Option B: Auto-routing by product name (for teams with many products)**
Leave the Redmine Project ID blank. The middleware will:
1. Derive a project identifier from the DefectDojo product name.
2. Search Redmine for a matching project.
3. Create a new project automatically if none is found (requires Create Projects permission).

### Step 3.5 — Find Your Priority IDs

Look up the numeric priority IDs so the middleware can map DefectDojo severity levels (Critical, High, Medium, Low, Info) to Redmine priority levels (Urgent, High, Normal, Low).

**Via the API:**
```bash
curl -H "X-Redmine-API-Key: YOUR_API_KEY" https://redmine.example.com/enumerations/issue_priorities.json
```

Example response:
```json
{
  "issue_priorities": [
    { "id": 1, "name": "Low", "is_default": false },
    { "id": 2, "name": "Normal", "is_default": true },
    { "id": 3, "name": "High", "is_default": false },
    { "id": 4, "name": "Urgent", "is_default": false },
    { "id": 5, "name": "Immediate", "is_default": false }
  ]
}
```

**Via the Redmine UI:**
Go to **Administration → Enumerations** and find the "Issue priorities" section. Note each priority name and its position/ID.

Here is the suggested mapping:

| Middleware Setting | Maps to Severity | Suggested Redmine Priority |
|---|---|---|
| Critical Priority ID | Critical findings | "Immediate" or "Urgent" |
| High Priority ID | High findings | "High" |
| Medium Priority ID | Medium findings | "Normal" |
| Low Priority ID | Low findings | "Low" |
| Info Priority ID | Info/Informational findings | "Low" |
| Default Priority ID | Fallback when no severity match | "Normal" |

**Write down each priority's numeric ID.** You will enter them in the middleware settings.

### Step 3.6 — Find Your Status IDs (Optional)

> [!TIP]
> **You can skip this step.** When the status ID fields are left blank, the middleware automatically resolves status IDs by matching names:
> - Looks for a status named "New"
> - Looks for a status named "In Progress"
> - Looks for a status named "Feedback"
> - Looks for a status named "Resolve" or "Resolved"
> - Looks for a status named "Closed"
>
> This auto-resolve works for most standard Redmine installations. Only fill in manual IDs if your Redmine uses custom status names.

**Option A: Auto-Resolve (Recommended)**
Leave all status ID fields blank in Settings → Redmine Status. The middleware calls `GET /issue_statuses.json` and automatically matches by name.

**Option B: Look Up IDs via the API**
```bash
curl -H "X-Redmine-API-Key: YOUR_API_KEY" https://redmine.example.com/issue_statuses.json
```

Example response:
```json
{
  "issue_statuses": [
    { "id": 1, "name": "New", "is_closed": false },
    { "id": 2, "name": "In Progress", "is_closed": false },
    { "id": 3, "name": "Resolved", "is_closed": false },
    { "id": 4, "name": "Feedback", "is_closed": false },
    { "id": 5, "name": "Closed", "is_closed": true },
    { "id": 6, "name": "Rejected", "is_closed": true }
  ]
}
```

**Option C: Look Up IDs via the Redmine UI**
1. Log in to Redmine as an administrator.
2. Go to Administration → Issue Statuses.
3. Click each status name.
4. Note the numeric ID from the browser URL (e.g., `/issue_statuses/2/edit` means the ID is `2`).

#### Status Mapping Reference

Use this table to map each middleware field to the correct Redmine status:

| Middleware Setting | Redmine Status Name | What It Controls |
|---|---|---|
| New Status ID | "New" | Status set on newly created tickets |
| In Progress Status ID | "In Progress" | Recognized during polling to classify active work |
| Feedback Status ID | "Feedback" | Recognized during polling to classify feedback state |
| Resolved Status ID | "Resolved" | When detected, the finding enters the mitigation review queue |
| Closed Status ID | "Closed" | Used when an admin clicks "Review & Close" in mitigation review |

Note about status classification logic:
- **Resolved**: matches configured resolve status ID, or status name is "resolve" or "resolved"
- **In Progress**: matches configured in-progress ID, or name is "in progress" or "progress"
- **Closed**: matches configured closed ID, or name is "closed", "done", or "rejected" (but NOT if it also matches "resolve")

### Step 3.7 — Redmine Workflow Status

To map Redmine ticket statuses to the middleware workflow states (New, In Progress, Feedback, Resolved, Closed), you must configure the status IDs in the Settings page.

The screenshot below shows the workflow transition rules from a Redmine test environment, showing the allowed transitions between statuses:

![Redmine Workflow Transitions](/docs/media__1781966150774.png)

Ensure these IDs match the configured mappings in the middleware settings under **Settings > Redmine Status**.

### Step 3.8 — Set Up the Redmine Tracker (Optional)

If you want all tickets created by the middleware to use a specific Redmine tracker (e.g., "Bug", "Security Issue"), set the Tracker ID in settings.

**Find Tracker IDs:**
1. Go to Administration → Trackers.
2. Note the ID from the URL when clicking a tracker.

Common default values:
- Bug = 1
- Feature = 2
- Support = 3

If left blank, Redmine uses the project's default tracker.

---

## 4. Install and Start the Middleware

### Step 4.1 — Clone or Download the Repository

If you haven't already, get the project files onto your Docker host.

### Step 4.2 — Create the Environment File

```powershell
node scripts/generate-env.cjs
```

The generator creates `.env` when missing and fills only blank or missing
managed secrets in an existing `.env`. It does not replace non-empty values
unless you explicitly pass `--force`.

### Step 4.3 — Review the `.env` File

Open `.env` in a text editor and verify the generated values:

```ini
# Gateway port (the port you'll access in the browser)
GATEWAY_PORT=80

# DefectDojo Viewer app database
PG_DB=defectdojo_viewer
PG_USER=defectdojo
PG_PASSWORD=<set-a-strong-password-here>

# Middleware Hub auth database
AUTH_PG_DB=middleware_auth
AUTH_PG_USER=middleware_auth
AUTH_PG_PASSWORD=<set-a-strong-password-here>

# Shared JWT signing key (at least 32 characters)
JWT_SECRET=<set-a-long-random-string-here>

# Internal service token for Hub ↔ DefectDojo communication
AUTH_SERVICE_TOKEN=<set-another-random-string-here>

# First-start administrator password
AUTH_BOOTSTRAP_ADMIN_PASSWORD=<set-a-strong-bootstrap-password-here>
```

> [!WARNING]
> Keep `.env` private. Regenerate with `--force` only before the first startup
> or after you intentionally rotate matching database/auth state.

### Step 4.4 — Start All Containers

```powershell
docker compose up -d --build
```

This builds and starts six containers: gateway, hub, defectdojo, wazuh, db, and auth-db.

### Step 4.5 — Verify All Services Are Running

```powershell
docker compose ps
```

All services should show a `healthy` status. It may take 30–60 seconds for health checks to pass after first start.

---

## 5. Log In with the Bootstrap Administrator

1. Open your browser and go to:
   ```
   http://localhost
   ```
2. Log in with the bootstrap credentials:
   - **Username:** `admin`
   - **Password:** the configured `AUTH_BOOTSTRAP_ADMIN_PASSWORD`
3. To rotate the password:
   - Click **User Management** in the Hub administration section.
   - Edit the `admin` user and set a strong new password.

> [!CAUTION]
> Production requires an explicit bootstrap password and never creates
> `admin` / `admin` or overwrites existing credentials.

---

## 6. Configure DefectDojo Connection

1. From the Hub, click the **DefectDojo Viewer** card to open it.
2. In the sidebar, click **Settings** (admin only).
3. In the **Connection** section, fill in:

| Field | What to Enter |
|---|---|
| **DefectDojo URL** | Base URL only, e.g., `https://defectdojo.example.com` |
| **DefectDojo API Key** | The API key you copied in [Step 2](#2-prepare-defectdojo-external) |

4. Click **Save**.

---

## 7. Configure Redmine Connection

Still on the **Settings** page, fill in the **Redmine** connection fields:

| Field | What to Enter |
|---|---|
| **Redmine URL** | Base URL only, e.g., `https://redmine.example.com` |
| **Redmine API Key** | The API key you copied in [Step 3.3](#step-33--get-the-api-key) |
| **Redmine Project ID** | Your project identifier string (e.g., `security-findings`), or leave blank for auto-routing |
| **Redmine Tracker ID** | *(Optional)* Numeric tracker ID if you want a specific tracker, or leave blank for the project default |

Click **Save**.

---

## 8. Configure Redmine Priority and Status Mapping

Still on the **Settings** page, scroll to the **Redmine Status** section:

### Priority Mapping

Enter the numeric Redmine priority IDs you found in [Step 3.5](#step-35--find-your-priority-ids):

| Field | Enter Your ID |
|---|---|
| Critical Priority ID | e.g., `5` (Immediate) |
| High Priority ID | e.g., `3` (High) |
| Medium Priority ID | e.g., `2` (Normal) |
| Low Priority ID | e.g., `1` (Low) |
| Info Priority ID | e.g., `1` (Low) |
| Default Priority ID | e.g., `2` (Normal) |

### Status Mapping

Either leave all status ID fields **blank** (recommended — the middleware auto-resolves by name) or enter the IDs from [Step 3.6](#step-36--find-your-status-ids-optional).

### Status Poll Interval

Set how often (in seconds) the middleware checks Redmine for ticket status updates. The default is `60` seconds. A value of `300` (5 minutes) is reasonable for most teams.

Click **Save**.

---

## 9. Run Your First Sync

1. Return to the **Dashboard** (click Dashboard in the sidebar).
2. Click the **Sync Findings** button (visible to admins only).
3. In the sync modal, configure pull filters:
   - **Severity:** Choose which severity levels to pull (default: all).
   - **Active:** `true` (pull only active findings).
   - **Verified:** Leave blank or set to `true`.
   - **Is Mitigated:** `false` (skip already mitigated findings).
   - **Product / Engagement IDs:** Leave blank to pull all, or enter specific IDs.
4. Click **Pull & Sync**.
5. Watch the progress overlay — it shows real-time steps:
   - Pulling findings from DefectDojo
   - Compacting duplicates into grouped findings
   - Syncing with Redmine (checking/creating tickets)
   - Running mitigation rechecks

---

## 10. Verify Everything Works

After the sync completes, check these items:

| What to Check | Where | Expected Result |
|---|---|---|
| **Dashboard cards** | Dashboard page | Vulnerability Status, Ticket Workflow, and Severity Distribution cards show data |
| **Findings table** | Dashboard (bottom) or Findings page | Compacted findings rows with severity, title, and Redmine status |
| **Redmine tickets** | Your Redmine project | New tickets created by the middleware with vulnerability details |
| **Sync History** | Sidebar → Sync History | A "Success" entry for your first sync with finding/ticket counts |
| **Products** | Sidebar → Products | Grid of synced DefectDojo products |

### Troubleshooting

| Problem | Likely Cause | Fix |
|---|---|---|
| Cannot reach `http://localhost` | Gateway not running or wrong port | Run `docker compose ps` and check `GATEWAY_PORT` in `.env` |
| 401 from DefectDojo during sync | API key invalid or expired | Regenerate the key in DefectDojo and update Settings |
| 403 from DefectDojo | API user lacks product visibility | Grant the user access to the required products |
| 403 from Redmine | REST API not enabled | Enable it in Redmine Admin → Settings → API |
| Redmine 422 error | User lacks permissions or project/tracker doesn't exist | Check user permissions and project identifier |
| "Use the project identifier, not numeric ID" | Entered a number in Project ID field | Use the string identifier from the project URL |
| Containers not healthy after 2 minutes | Database initialization failed | Check logs with `docker compose logs db auth-db` |
| DefectDojo or Redmine on localhost unreachable | Using `localhost` in URL, resolves to container | Use `http://host.docker.internal:PORT` (Docker Desktop) or host IP (Linux) |

---

## 11. What to Do Next

Now that the system is running and syncing, here are your recommended next steps:

### Create Additional Users
Go to the Hub → **User Management** → **Add User**. Assign roles:
- **Admin** — full access to settings, sync, and mitigation review.
- **Viewer** — read-only access to dashboards and findings. Can be restricted to specific products.

### Set Up a Regular Sync Workflow
Run **Sync Findings** periodically (daily or after each scan cycle) to keep findings current.

### Review the Mitigation Queue
When Redmine tickets are marked "Resolved" but DefectDojo still shows the finding as active, items appear in **Mitigation Review**. Admins should review and confirm or ignore these.

### Explore Wazuh Viewer
Click the **Wazuh Viewer** card on the Hub for a SIEM-style dashboard mockup. Note: this is currently a UI demonstration using sample data, not a live Wazuh integration.

### Read the Full Documentation
For detailed coverage of every feature, see the in-app documentation reader (Hub → Docs, admin only) or the user guide documents for a complete walkthrough.

---

## Quick Reference

| Resource | URL |
|---|---|
| Hub (Login & Switcher) | `http://localhost/` |
| DefectDojo Viewer | `http://localhost/defectdojo/` |
| DefectDojo Settings | `http://localhost/defectdojo/#settings` |
| Wazuh Viewer | `http://localhost/wazuh/` |
| In-App Documentation | `http://localhost/#docs` |
