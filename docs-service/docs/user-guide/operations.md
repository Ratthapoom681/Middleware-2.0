# Operations Guide

Use this guide for recurring security workflows, first-time setup verification, troubleshooting, and quick access to important URLs and controls.

## Contents

1. [First-Time Admin Setup & Verification](#first-time-admin-setup--verification)
2. [Common Workflows](#common-workflows)
3. [Troubleshooting](#troubleshooting)
4. [Quick Reference](#quick-reference)

## First-Time Admin Setup & Verification

Follow this workflow to set up the system for the first time and verify that all integrations are working correctly.

### 1. Complete Prerequisites
Before starting, ensure you have completed all steps in the [Quick Start Guide](../quick-start.md). You need:
- DefectDojo API v2 Token
- Redmine API Key
- Redmine Project Identifier

### 2. Start and Secure the System
1. Start the system: `docker compose up -d --build`
2. Log in to the Hub at `http://localhost:8080` with `admin` / `admin`.
3. Open **User Management**.
4. Create named admin and viewer accounts for your team.
5. Change the password for the default `admin` account, or suspend it if you created a new admin account for yourself.

### 3. Configure Integrations
1. Open **DefectDojo Viewer**.
2. Go to **Settings > Connection**.
3. Enter your DefectDojo URL and API Key.
4. Enter your Redmine URL and API Key.
5. Enter your Redmine Project ID (must be a string identifier, e.g., `security-findings`).
6. Click **Save Configuration**.

### 4. Configure Redmine Status
1. Go to **Settings > Redmine Status**.
2. Set the **Status poll interval** (e.g., `300` for 5 minutes).
3. Set your priority IDs (or leave defaults if your Redmine uses standard priorities).
4. Set your status IDs, or leave them blank to use auto-resolve by name.
5. Click **Save Configuration**.

### 5. Verify Integration (The "First Sync" Test)
1. Go to **Dashboard**.
2. Click **Sync Findings**.
3. In the filters, set:
   - **Active**: Yes
   - **Mitigated**: No
4. Click **Pull & Sync**.
5. Watch the progress modal carefully. It should progress through:
   - *Pulling findings* (verifies DefectDojo connection)
   - *Resolving context*
   - *Compacting*
   - *Syncing Redmine* (verifies Redmine connection)
6. If the sync completes successfully without errors, your integrations are working perfectly!
7. Check the dashboard counts and the findings table.

## Common Workflows

### Daily Vulnerability Review

1. Open DefectDojo Viewer.
2. Review Dashboard summary.
3. Search/filter findings by severity, company, engagement, or Redmine state.
4. Open high-risk findings.
5. Review endpoints, CVEs/CWEs, impact, and mitigation.
6. Open Redmine where available.
7. Escalate missing or stale ticket states to an admin.

### Admin Sync Review

1. Run Sync Findings.
2. Read the Sync All Progress summary.
3. Open Sync History.
4. Filter by Failed or Partial.
5. Open rows with new findings.
6. Fix configuration or external API issues.
7. Run Sync Findings again if needed.

### Mitigation Closure Review

1. Open Mitigation Review.
2. Search for the Redmine issue or product.
3. Confirm the item should be closed.
4. Add a reviewer note.
5. Click Review & Close.
6. Check History & Logs for the recorded action.

## Troubleshooting

### Browser Cannot Reach the Hub

1. Check the configured gateway port in `.env`.
2. Run:
   ```powershell
   docker compose ps
   ```
3. Confirm `gateway`, `hub`, `defectdojo`, `wazuh`, `db`, and `auth-db` are running.
4. If running on a server, confirm the firewall allows inbound traffic on the gateway port.

### Login Fails

1. Confirm username and password.
2. Ask an admin to check whether the account is suspended.
3. Ask an admin to reset the password.
4. If this is the first run, try `admin` / `admin`.

### App Card Shows Offline

1. Wait a few seconds and refresh the Hub.
2. Run:
   ```powershell
   docker compose ps
   ```
3. Restart the affected service:
   ```powershell
   docker compose start defectdojo
   docker compose start wazuh
   ```
4. Rebuild if the service image changed:
   ```powershell
   docker compose up -d --build defectdojo
   ```

### Sync Findings: 401 Unauthorized from DefectDojo

1. This means your DefectDojo API key is invalid or expired.
2. Log in to DefectDojo and generate a new API v2 key.
3. Go to DefectDojo Viewer > Settings > Connection and update the key.
4. Run Sync Findings again.

### Sync Findings: 403 Forbidden from DefectDojo

1. This means your API key is valid, but the user does not have permission to view the requested findings or products.
2. In DefectDojo, ensure the user account associated with the API key has the correct roles (e.g., Reader or Writer) for the products you are trying to sync.

### Sync Findings: Redmine Project ID Error

1. **Error message:** *"Use the Redmine project identifier, not the numeric Redmine project id."*
2. You entered a number (like `42`) in the Redmine Project ID field.
3. Go to Settings > Connection and change it to the string identifier (like `security-findings`).

### Redmine Ticket Creation Fails (422 Unprocessable Entity)

1. **Error message:** *Failed to create Redmine issue...*
2. This usually means the Redmine API rejected the ticket data. Common causes:
   - The user's API key lacks "Create Issues" permission.
   - The specified project does not exist.
   - The specified tracker ID does not exist or is not enabled for the project.
   - A required custom field in Redmine is missing (the middleware only sends subject, description, tracker_id, and priority_id).

### Redmine Counts Look Stale

1. Open **Settings > Backup**.
2. Click **Rebuild Redmine Status**.
3. Wait for the rebuild to finish.
4. Return to Dashboard.

### Database Password Errors After Editing `.env`

PostgreSQL keeps credentials in persistent Docker volumes after the first startup. If you change database usernames, passwords, or database names after volumes already exist, the old values may still be active.

For a local reset:

```powershell
docker compose down -v
docker compose up -d --build
```

> [!CAUTION]
> This deletes Docker volumes, including stored local data. Use only when you intentionally want a clean environment.

## Quick Reference

### URLs

| Page | Local URL |
| --- | --- |
| Hub | `http://localhost:8080/` |
| DefectDojo Viewer | `http://localhost:8080/defectdojo/` |
| Wazuh Viewer | `http://localhost:8080/wazuh/` |
| DefectDojo Products | `http://localhost:8080/defectdojo/#products` |
| DefectDojo Settings | `http://localhost:8080/defectdojo/#settings` |

### Important Buttons

| Button | Location | Purpose |
| --- | --- | --- |
| **Sign In** | Hub login | Start a session. |
| **User Management** | Hub admin section | Manage Hub users. |
| **Back to Hub** | Workspace sidebar | Return to app selector. |
| **Sync Findings** | DefectDojo Dashboard | Pull DefectDojo data and sync Redmine state. |
| **Pull & Sync** | Sync filter modal | Start the selected sync. |
| **Open in Redmine** | Finding details | Open or create/sync Redmine work. |
| **Review & Close** | Mitigation Review | Close reviewed Redmine mitigation items. |
| **Save Configuration** | Settings | Save Connection or Redmine Status settings. |
| **Rebuild Redmine Status** | Settings > Backup | Refresh local Redmine workflow cache. |
| **Clear All Data** | Settings > Backup | Remove local finding/workflow data while keeping users and settings. |
