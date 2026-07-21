# Internal Security Middleware Hub - User Guide

This guide explains how to use the Internal Security Middleware Hub, DefectDojo Viewer, and Wazuh Viewer step by step. It is written for day-to-day users, security analysts, and administrators.

## Contents

1. [Prerequisites and External Setup](#prerequisites-and-external-setup)
2. [What the System Does](#what-the-system-does)
3. [Roles and Access](#roles-and-access)
4. [Start the System](#start-the-system)
5. [Overall User Flow](#overall-user-flow)
6. [Log In and Use the Hub](#log-in-and-use-the-hub)
7. [Manage Hub Users](#manage-hub-users)
8. [Use DefectDojo Viewer](#use-defectdojo-viewer)
9. [Dashboard](#dashboard)
10. [Configure Settings](#configure-settings)
11. [Sync Findings](#sync-findings)
12. [Understanding Compacted Findings](#understanding-compacted-findings)
13. [Findings and Redmine Tickets](#findings-and-redmine-tickets)
14. [Redmine Ticket Lifecycle](#redmine-ticket-lifecycle)
15. [Products and Engagements](#products-and-engagements)
16. [Sync History](#sync-history)
17. [Mitigation Review](#mitigation-review)
18. [Use Wazuh Viewer](#use-wazuh-viewer)
19. [Common Workflows](#common-workflows)
20. [Troubleshooting](#troubleshooting)
21. [Quick Reference](#quick-reference)

---

## 1. Prerequisites and External Setup

Before you can use the system, you must configure external integrations.

### Before You Begin
Checklist of what you need:
- Docker Desktop or Docker Engine with Compose V2
- A modern web browser
- A running DefectDojo instance (v2.x) with admin/API access
- A running Redmine instance with admin or privileged user access
- Network connectivity from the Docker host to both DefectDojo and Redmine

### Set Up DefectDojo API Access
1. Log in to your DefectDojo instance as a user who has visibility to the products you want to sync.
2. Click your username in the top-right corner.
3. Click "API v2 Key" (or navigate to `/api/key-v2`).
4. Copy the API key shown, or click "Regenerate" to create a new one.

**Important details:**
- The middleware ONLY READS from DefectDojo.
- URL format: Use the base URL only, e.g., `https://defectdojo.example.com`. Do NOT include `/api/v2/`.

### Set Up Redmine API Access
1. Enable the REST API: Log in to Redmine as admin → Administration → Settings → API tab → check "Enable REST web service" → Save.
2. Choose an API user: The user needs permissions for View Issues, Create Issues, Edit Issues, View Issue Statuses, and Create Projects (if auto-routing). An Administrator account is recommended.
3. Get the API Key: Log in as the user → My Account → API access key (right sidebar) → Show/Reset → copy the key.

**Important details:**
- The middleware READS AND WRITES to Redmine.
- URL format: Use the base URL only, e.g., `https://redmine.example.com`.

### Find Your Redmine Status IDs
> [!TIP]
> **You can leave the status ID fields blank in Settings.** When empty, the middleware automatically resolves status IDs by matching names ("New", "In Progress", "Feedback", "Resolved", "Closed").

If you want to map them manually, find the numeric IDs by navigating to Administration → Issue Statuses in Redmine and checking the URLs, or by hitting the `/issue_statuses.json` API endpoint.

### Find Your Redmine Priority IDs
Find the numeric priority IDs by navigating to Administration → Enumerations in Redmine and checking the URLs, or by hitting the `/enumerations/issue_priorities.json` API endpoint. Map them logically (Critical = Urgent, High = High, etc.).

### Find Your Redmine Project Identifier
> [!CAUTION]
> The Redmine Project ID field requires a **string identifier** (like `security-findings`), NOT a numeric ID.

You can set a single project identifier in settings, or leave it blank to let the middleware automatically derive projects from DefectDojo product names.

---

## 2. What the System Does

The Internal Security Middleware Hub is the entry point for internal security tools.

- **Hub** handles sign-in, single sign-on, app switching, and user administration.
- **DefectDojo Viewer** pulls DefectDojo findings, groups duplicate results into compacted findings, tracks Redmine ticket status, and manages mitigation review.
- **Wazuh Viewer** is a static SIEM-style mockup for alerts and incidents.

All services are accessed through a single Nginx gateway port (default: 80).

---

## 3. Roles and Access

There are two main roles.

| Role | Can do |
| --- | --- |
| **Admin** | Manage users, configure integrations, run Sync Findings, view sync history, and process mitigation reviews. |
| **Viewer** | View dashboards, findings, products, engagements, and Redmine status. |

Viewer accounts can be restricted to specific product names. Admin accounts have full access.

---

## 4. Start the System

1. Generate any missing secrets and start the stack:
   ```powershell
   node scripts/compose-up.cjs
   ```
2. Review `.env`. The wrapper creates or fills blank values for:
   - `PG_PASSWORD`
   - `AUTH_PG_PASSWORD`
   - `JWT_SECRET` (at least 32 characters)
   - `AUTH_SERVICE_TOKEN`
   - `MFA_ENCRYPTION_KEY` (base64-encoded 32-byte key)
   - `AUTH_BOOTSTRAP_ADMIN_PASSWORD`
   It also replaces known unsafe auth placeholders, preserves non-empty
   secrets, and runs `docker compose up -d --build`.
3. Verify all containers are running:
   ```powershell
   docker compose ps
   ```
4. Open the Hub in a browser:
   ```text
   http://localhost
   ```

Fresh production installs use username `admin` and the password configured in
`AUTH_BOOTSTRAP_ADMIN_PASSWORD`. Existing credentials are never reset at startup.

---

## 5. Overall User Flow

### For an Admin
1. Start the stack and log in to the Hub.
2. Open User Management and create required users.
3. Open DefectDojo Viewer → Settings → Connection. Configure DefectDojo and Redmine APIs.
4. Configure Redmine Status values.
5. Return to Dashboard and click Sync Findings.
6. Review the dashboard, Sync History, and Mitigation Review queue.

### For a Viewer
1. Log in to the Hub.
2. Open DefectDojo Viewer.
3. Review Dashboard summary cards.
4. Filter findings by severity, status, company, or engagement.
5. Open a finding row to review details and linked Redmine issues.

---

## 6. Log In and Use the Hub

### Log In
1. Open `http://localhost`.
2. Enter your Username and Password.
3. Click Sign In.

### Choose a Workspace
Click a card (DefectDojo Viewer or Wazuh Viewer) to open that workspace. Use **Back to Hub** inside the workspace when you want to return.

### Sign Out
Click **Sign Out** in the Hub top bar, or inside a workspace.

### Manage Your Profile and Authenticator

Open the profile menu from the Hub, DefectDojo Viewer, Wazuh Viewer, or Documentation and select **Your profile**. The central Profile page lets you:

- Add or update an optional email address.
- Change your password. New passwords must contain 12–128 characters; changing it signs out every session.
- Enable Google Authenticator, Microsoft Authenticator, or another compatible authenticator app.

To enable an authenticator, choose the app, confirm your password, scan the QR code (or enter the manual key), and enter the current six-digit code. Save the ten recovery codes shown at the end; each can be used once if the authenticator is unavailable.

When MFA is enabled, sign-in asks for a six-digit code after the password. Select **Use a recovery code** when needed. From Profile you can replace the authenticator, regenerate recovery codes, or turn MFA off. These sensitive actions require the current password and a current authenticator or recovery code.

---

## 7. Manage Hub Users

Admins can manage identities from the Hub.

1. Find the **Administration** section on the Hub page and click **User Management**.
2. **Add a User**: Click Add User, enter details, choose Role (Admin/Viewer), and Allowed Products for Viewers.
3. **Edit/Delete/Reset**: Use the table actions to modify existing users. You cannot delete your own active user.
4. **Reset MFA**: If a user loses both their authenticator and recovery codes, use the shield-off action. Re-enter your administrator password, record a reason, and type the target username. This removes MFA and signs the target out; administrators manage their own MFA from Profile.

---

## 8. Use DefectDojo Viewer

Open **DefectDojo Viewer** from the Hub. The sidebar provides access to the Dashboard, Sync History (Admin), Mitigation Review (Admin), Settings (Admin), and Logout.

---

## 9. Dashboard

The Dashboard shows a high-level overview.

- **Vulnerability Status**: Active vs. Mitigated findings.
- **Ticket Workflow**: Redmine tickets grouped by status (New, In Progress, Feedback, Resolved, Closed).
- **Severity Distribution**: Findings categorized by risk level.

The bottom half contains the embedded findings table, where you can search and filter.

---

## 10. Configure Settings

Admins must configure settings before the app can be used.

### Connection
Enter your DefectDojo URL (base URL only) and API Key. Enter your Redmine URL (base URL only) and API Key. Set the Redmine Project ID (must be a string identifier).

### Redmine Status
- Set the **Status poll interval** (e.g., 300 seconds).
- Set **Priority IDs** mapping severities to Redmine priorities.
- Set **Status IDs** (or leave blank to auto-resolve "New", "In Progress", "Resolved", etc. by name).

### Backup
Create configuration backups, rebuild the Redmine status cache, or clear all local data.

---

## 11. Sync Findings

Only admins can run Sync Findings.

1. Go to **Dashboard** and click **Sync Findings**.
2. Choose pull filters (Severity, Product IDs, Active, Verified, Mitigated).
3. Click **Pull & Sync**.
4. The system will pull findings, compact them, sync with Redmine, and run mitigation rechecks.
5. Watch the progress modal for any warnings.

---

## 12. Understanding Compacted Findings

Automated scanners generate many duplicates. The middleware groups raw findings into "families":
- **Upgrade Family**: Outdated package warnings.
- **SSL Certificate Trust Family**: Generic SSL warnings.
- **Shared CVE Family**: Findings with the same CVE IDs.
- **Strict Fingerprint Family**: Findings with identical descriptions and titles.

One compacted row equals one actionable issue, and Redmine tickets are created per compacted group.

---

## 13. Findings and Redmine Tickets

Click any finding row to view its details (severity, description, endpoints, CVEs, and mitigation guidance).

**Open in Redmine**: Admins can click this to create a new ticket or open an existing one. Viewers can only open existing tickets.

---

## 14. Redmine Ticket Lifecycle

1. **Creation**: The middleware creates a ticket using a deterministic sync key, populating the subject, description (with sync metadata), and priority.
2. **Polling**: The system periodically checks Redmine for status updates.
3. **Mitigation Review Trigger**: When Redmine reports a ticket as "Resolved", but DefectDojo still considers it active, it enters the Mitigation Review queue.

---

## 15. Products and Engagements

Use the `/defectdojo/#products` route to view a grid of all synced products. Click a product to see its specific dashboard, severity mix, and engagement drilldown.

---

## 16. Sync History

Admins can view an audit log of all syncs at **Sync History**. You can filter by status (Success, Partial, Failed) and view new finding details for each sync run.

---

## 17. Mitigation Review

The Mitigation Review queue acts as a safety gate.

1. When a Redmine ticket is Resolved, admins review it here.
2. Click the action button on a pending item.
3. Add a Reviewer note.
4. Click **Review & Close** to close the ticket in Redmine, or **Ignore** to archive the review without closing.

---

## 18. Use Wazuh Viewer

> [!NOTE]
> **Wazuh Viewer is currently a UI mockup.** It displays sample data and does not connect to a live Wazuh instance.

Review the mock dashboards, alerts, and incidents. Incidents created in the UI are lost upon refresh. Real Wazuh API integration is planned for a future release.

---

## 19. Common Workflows

### Daily Vulnerability Review
Check the dashboard, filter by severity, review critical findings, and open linked Redmine tickets to ensure they are progressing.

### Admin Sync Review
Run Sync Findings, review the progress modal, and check Sync History for any Failed or Partial syncs caused by API errors or missing Redmine projects.

---

## 20. Troubleshooting

- **Browser Cannot Reach Hub**: Check `GATEWAY_PORT` in `.env` and run `docker compose ps`.
- **401 Unauthorized from DefectDojo**: API key is invalid or expired.
- **403 Forbidden from DefectDojo**: API user lacks visibility to the requested products.
- **Redmine Project ID Error**: You entered a numeric ID in Settings > Connection. Use a string identifier instead.
- **Redmine 422 Unprocessable Entity**: The user lacks "Create Issues" permission, or the project/tracker doesn't exist.

---

## 21. Quick Reference

| Feature | URL |
| --- | --- |
| Hub | `http://localhost/` |
| DefectDojo Viewer | `http://localhost/defectdojo/` |
| DefectDojo Settings | `http://localhost/defectdojo/#settings` |
| Wazuh Viewer | `http://localhost/wazuh/` |
