# Prerequisites and External Setup

Use this guide to prepare everything needed before you can configure and use the Internal Security Middleware Hub.

## Contents
1. [Before You Begin](#before-you-begin)
2. [Set Up DefectDojo API Access](#set-up-defectdojo-api-access)
3. [Set Up Redmine API Access](#set-up-redmine-api-access)
4. [Find Your Redmine Status IDs](#find-your-redmine-status-ids)
5. [Find Your Redmine Priority IDs](#find-your-redmine-priority-ids)
6. [Redmine Workflow Status](#redmine-workflow-status)
7. [Set Up the Redmine Project](#set-up-the-redmine-project)
8. [Set Up the Redmine Tracker (Optional)](#set-up-the-redmine-tracker-optional)
9. [Network and Connectivity Requirements](#network-and-connectivity-requirements)
10. [Next Steps](#next-steps)

## Before You Begin
Checklist of what you need:
- Docker Desktop (Windows/Mac) or Docker Engine with Compose V2 (Linux)
- A modern web browser
- A running DefectDojo instance (v2.x) with admin/API access
- A running Redmine instance with admin or privileged user access
- Network connectivity from the Docker host to both DefectDojo and Redmine

## Set Up DefectDojo API Access

Step-by-step guide:
1. Log in to your DefectDojo instance as a user who has visibility to the products/findings you want to sync.
2. Click your username in the top-right corner.
3. Click "API v2 Key" (or navigate to `/api/key-v2`).
4. Copy the API key shown, or click "Regenerate" to create a new one.

Important technical details:
- The middleware sends requests using the header: `Authorization: Token <your-api-key>`
- The middleware ONLY READS from DefectDojo — it never creates, modifies, or deletes any data in DefectDojo.
- The API user needs read access to: findings, tests, engagements, products, and endpoints.
- Endpoints called: `GET /api/v2/findings/`, `GET /api/v2/tests/{id}/`, `GET /api/v2/engagements/{id}/`, `GET /api/v2/products/{id}/`, `GET /api/v2/endpoints/`

URL format:
- Use the base URL only, e.g., `https://defectdojo.example.com`
- Do NOT include `/api/v2/` at the end
- Do NOT include a trailing slash

Verification:
```bash
curl -H "Authorization: Token YOUR_API_KEY" https://defectdojo.example.com/api/v2/findings/?limit=1
```
If successful, you should get a JSON response with findings data.

Common mistakes:
- Using the wrong URL format (including /api/v2/)
- API key expired or regenerated
- API user does not have visibility to the products being synced
- Network firewall blocking access from Docker host

## Set Up Redmine API Access

Step-by-step:

### Step 1: Enable the REST API
1. Log in to Redmine as an administrator.
2. Go to Administration → Settings.
3. Click the API tab.
4. Check "Enable REST web service".
5. Click Save.

> [!WARNING]
> If the REST API is not enabled, ALL API requests from the middleware will fail with 403 Forbidden errors, regardless of your API key.

### Step 2: Choose or Create the API User
The middleware needs a Redmine user with these permissions:
- **View Issues** — to search for existing tickets
- **Create Issues** — to create new vulnerability tickets
- **Edit Issues** — to update ticket priority, description, and add notes
- **View Issue Statuses** — to resolve status IDs
- **Create Projects** (optional) — only needed if you want the middleware to auto-create Redmine projects based on DefectDojo product names

> [!TIP]
> The simplest approach is to use a Redmine account with the **Administrator** role. This guarantees all required permissions are available.

### Step 3: Get the API Key
1. Log in to Redmine as the API user.
2. Go to My Account (click your username → My account, or navigate to `/my/account`).
3. In the right sidebar, find "API access key".
4. Click "Show" to reveal the existing key, or click "Reset" to generate a new one.
5. Copy the API key.

Important technical details:
- The middleware sends requests using the header: `X-Redmine-API-Key: <your-api-key>`
- The middleware READS AND WRITES to Redmine — it creates issues, updates issues, and can create projects.
- Endpoints called:
  - `GET /projects/{identifier}.json` — look up projects
  - `GET /projects.json` — list/search projects
  - `POST /projects.json` — create projects (if auto-routing)
  - `GET /issues.json` — search for existing issues
  - `POST /issues.json` — create new issues
  - `PUT /issues/{id}.json` — update existing issues
  - `GET /issues/{id}.json` — fetch issue status
  - `GET /issue_statuses.json` — list all statuses

URL format:
- Use the base URL only, e.g., `https://redmine.example.com`
- Do NOT include a trailing slash

Verification:
```bash
curl -H "X-Redmine-API-Key: YOUR_API_KEY" https://redmine.example.com/issue_statuses.json
```
If successful, you should see a JSON array of issue statuses with their IDs.

Common mistakes:
- REST API not enabled in Redmine admin settings
- User lacks required project-level permissions
- Wrong URL format

## Find Your Redmine Status IDs

The middleware settings ask for numeric Redmine status IDs (for example, "New" = 1, "In Progress" = 2). These IDs map the middleware's ticket workflow to your Redmine instance's status definitions.

> [!TIP]
> **You can leave the status ID fields blank.** When empty, the middleware automatically resolves status IDs by matching names:
> - Looks for a status named "New"
> - Looks for a status named "In Progress"
> - Looks for a status named "Feedback"
> - Looks for a status named "Resolve" or "Resolved"
> - Looks for a status named "Closed"
>
> This auto-resolve works for most standard Redmine installations. Only fill in manual IDs if your Redmine uses custom status names.

### Option A: Auto-Resolve (Recommended)
Leave all status ID fields blank in Settings → Redmine Status. The middleware calls `GET /issue_statuses.json` and automatically matches by name.

### Option B: Look Up IDs via the API
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

### Option C: Look Up IDs via the Redmine UI
1. Log in to Redmine as an administrator.
2. Go to Administration → Issue Statuses.
3. Click each status name.
4. Note the numeric ID from the browser URL (e.g., `/issue_statuses/2/edit` means the ID is `2`).

### Status Mapping Reference

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

## Find Your Redmine Priority IDs

The middleware maps DefectDojo finding severity levels to Redmine ticket priorities. This ensures Critical findings get Urgent priority in Redmine, while Info findings get Low priority.

### Look Up Priority IDs via the API
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

### Look Up Priority IDs via the Redmine UI
1. Go to Administration → Enumerations.
2. Find the "Issue priorities" section.
3. Note each priority name and its position/ID.

### Priority Mapping Reference

| Middleware Setting | Maps to Severity | Suggested Redmine Priority |
|---|---|---|
| Critical Priority ID | Critical findings | "Immediate" or "Urgent" |
| High Priority ID | High findings | "High" |
| Medium Priority ID | Medium findings | "Normal" |
| Low Priority ID | Low findings | "Low" |
| Info Priority ID | Info/Informational findings | "Low" |
| Default Priority ID | Fallback when no severity match | "Normal" |

## Redmine Workflow Status

To map Redmine ticket statuses to the middleware workflow states (New, In Progress, Feedback, Resolved, Closed), you must configure the status IDs in the Settings page.

The screenshot below shows the workflow transition rules from a Redmine test environment, showing the allowed transitions between statuses:

![Redmine Workflow Transitions](/docs/media__1781966150774.png)

### Look Up Status IDs via the API
To find the exact status IDs configured in your Redmine instance, query the issue statuses endpoint:
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
    { "id": 5, "name": "Closed", "is_closed": true }
  ]
}
```

Ensure these IDs match the configured mappings in the middleware settings under **Settings > Redmine Status**.

## Set Up the Redmine Project

The middleware needs to know which Redmine project to create tickets in.

> [!CAUTION]
> The Redmine Project ID field requires a **string identifier** (like `security-findings`), NOT a numeric ID (like `42`). If you enter a number, the system will reject it with an error: *"Use the Redmine project identifier, not the numeric Redmine project id."*

### Find Your Project Identifier
1. Open your Redmine instance.
2. Navigate to the target project.
3. Look at the URL: `https://redmine.example.com/projects/my-security-project`
4. The identifier is `my-security-project`

### Project Routing Options

**Option A: Single project (recommended for small teams)**
Set the Redmine Project ID in settings to your project identifier (e.g., `security-findings`). All tickets are created in this project.

**Option B: Auto-routing by product name (for teams with many products)**
Leave the Redmine Project ID blank. The middleware will:
1. Derive a project identifier from the DefectDojo product name.
2. Search Redmine for a matching project.
3. Create a new project automatically if none is found (requires Create Projects permission).

## Set Up the Redmine Tracker (Optional)

If you want all tickets created by the middleware to use a specific Redmine tracker (e.g., "Bug", "Security Issue"), set the Tracker ID in settings.

### Find Tracker IDs
1. Go to Administration → Trackers.
2. Note the ID from the URL when clicking a tracker.

Common default values:
- Bug = 1
- Feature = 2
- Support = 3

If left blank, Redmine uses the project's default tracker.

## Network and Connectivity Requirements

The middleware runs inside Docker containers. The Docker host machine must be able to reach both your DefectDojo and Redmine instances over the network.

### Common Network Scenarios

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

### Verify Connectivity from Docker
To test from inside the Docker network:
```powershell
docker compose exec defectdojo wget -qO- --header="Authorization: Token YOUR_KEY" https://defectdojo.example.com/api/v2/findings/?limit=1
```

## Next Steps

Once you have completed all the prerequisites above, you are ready to:
1. Start the system — see the [Hub Guide](hub.md)
2. Configure connections in Settings — see the [Vulnerability Guide](vulnerability.md), Settings section
3. Run your first sync — see the [Vulnerability Guide](vulnerability.md), Sync Findings section
