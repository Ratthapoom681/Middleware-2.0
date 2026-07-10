# Quick Start Guide

Use this guide to start the Internal Security Middleware Hub, connect DefectDojo and Redmine, and complete your first findings sync.

> [!IMPORTANT]
> Follow the steps in order. Do not continue past a **Checkpoint** until it passes. If you stop, return to the first unchecked item in the progress tracker.

## Your progress

- [ ] 1. Confirm the prerequisites
- [ ] 2. Prepare DefectDojo
- [ ] 3. Prepare Redmine
- [ ] 4. Start the middleware
- [ ] 5. Sign in and secure the admin account
- [ ] 6. Connect DefectDojo
- [ ] 7. Connect Redmine and confirm project routing
- [ ] 8. Map Redmine priorities and statuses
- [ ] 9. Run the first sync
- [ ] 10. Verify the result

---

## 1. What You Need Before Starting

**You are here:** Prerequisites → DefectDojo → Redmine → Install → Sign in → Connect DefectDojo → Connect Redmine → Map → Sync → Verify

Make sure you have:

| Requirement | What you need |
|---|---|
| Docker | Docker Desktop on Windows/macOS, or Docker Engine with Compose V2 on Linux |
| Browser | A current version of Chrome, Edge, or Firefox |
| DefectDojo | A running v2.x instance with at least one product containing findings |
| Redmine | A running instance and access to an administrator or suitably privileged account |
| Network access | The Docker host can reach both external systems |

### Choose URLs that work from Docker

The middleware runs inside containers. URLs entered later must be reachable **from the containers**, not only from your browser.

- For services on your network, use their normal hostname or IP address, such as `https://defectdojo.internal.example`.
- If a service runs on the same Windows or macOS machine as Docker, use `http://host.docker.internal:PORT`.
- On Linux, use the Docker host's reachable IP address or configure an appropriate Docker network.
- Do not use `localhost` or `127.0.0.1` for a host service. Inside a container, those addresses point back to that container.
- If your organization uses a proxy or VPN, make sure Docker is configured to use it.

> **Checkpoint 1:** Docker is running, and you can open both DefectDojo and Redmine from the Docker host.

---

## 2. Prepare DefectDojo (External)

**You are here:** Prerequisites → **DefectDojo** → Redmine → Install → Sign in → Connect DefectDojo → Connect Redmine → Map → Sync → Verify

You need a DefectDojo API v2 key with read access to the findings you want to sync.

1. Sign in to DefectDojo as the API user.
2. Select your username in the top-right corner.
3. Select **API v2 Key**, or open `/api/key-v2` directly.
4. Copy the displayed key. If necessary, select **Regenerate** first.
5. Keep the base URL and API key available for Step 6.

Use the base URL only:

```text
https://defectdojo.example.com
```

Do not add `/api/v2/` or a trailing slash.

### Test the key

Run this from the Docker host, replacing both placeholders:

```bash
curl -H "Authorization: Token YOUR_API_KEY" "https://defectdojo.example.com/api/v2/findings/?limit=1"
```

A JSON response means the URL and key work. The API user must be able to read findings, tests, engagements, products, and endpoints.

> **Checkpoint 2:** The test returns JSON instead of an authentication or permission error.

If it fails, check the URL format, regenerate the key if needed, confirm the user can see the target products, and check network or firewall rules.

---

## 3. Prepare Redmine (External)

**You are here:** Prerequisites → DefectDojo → **Redmine** → Install → Sign in → Connect DefectDojo → Connect Redmine → Map → Sync → Verify

The middleware reads from and writes to Redmine. Complete each sub-step before starting the application.

### Step 3.1 — Enable the REST API

1. Sign in to Redmine as an administrator.
2. Go to **Administration → Settings → API**.
3. Enable **REST web service**.
4. Select **Save**.

> [!WARNING]
> If the REST API is disabled, middleware requests fail with `403 Forbidden` even when the API key is valid.

### Step 3.2 — Check the API user's permissions

The Redmine API user needs these permissions in every target project:

| Permission | Why it is needed |
|---|---|
| View Issues | Find existing tickets |
| Create Issues | Create vulnerability tickets |
| Edit Issues | Update tickets and add notes |
| View Issue Statuses | Resolve status names and IDs |
| Create Projects | Optional; required only when the middleware must create a missing project |

Using a dedicated administrator account is the simplest initial setup. You can reduce its permissions after the first successful sync.

### Step 3.3 — Get the API key

1. Sign in as the Redmine API user.
2. Go to **My account**.
3. Find **API access key** in the right sidebar.
4. Select **Show**, or select **Reset** to create a new key.
5. Copy the key and keep it available for Step 7.

Use the Redmine base URL without a trailing slash:

```text
https://redmine.example.com
```

Test the connection:

```bash
curl -H "X-Redmine-API-Key: YOUR_API_KEY" "https://redmine.example.com/issue_statuses.json"
```

A JSON list of issue statuses means the REST API, URL, and key work.

### Step 3.4 — Understand project routing

The middleware routes findings using their DefectDojo product context. It searches Redmine for a matching project and can create a missing project when the API user has **Create Projects** permission.

If your Redmine projects use different names, identifiers, or access rules, confirm the intended project before the first sync. A Redmine project identifier is the text in its URL—not its numeric database ID:

```text
https://redmine.example.com/projects/security-findings
                                     ^^^^^^^^^^^^^^^^^
                                     project identifier
```

### Step 3.5 — Find your priority IDs

The middleware needs numeric Redmine priority IDs to translate DefectDojo severities.

```bash
curl -H "X-Redmine-API-Key: YOUR_API_KEY" "https://redmine.example.com/enumerations/issue_priorities.json"
```

Record the IDs returned by Redmine. A typical mapping is:

| DefectDojo severity | Suggested Redmine priority |
|---|---|
| Critical | Immediate or Urgent |
| High | High |
| Medium | Normal |
| Low | Low |
| Info | Low |
| Default fallback | Normal |

You can also view priorities under **Administration → Enumerations → Issue priorities**.

### Step 3.6 — Find your status IDs (Optional)

For a standard Redmine installation, you can leave all status ID fields blank. The middleware automatically looks for **New**, **In Progress**, **Feedback**, **Resolve/Resolved**, and **Closed** by name.

Only collect manual IDs when your installation uses custom status names:

```bash
curl -H "X-Redmine-API-Key: YOUR_API_KEY" "https://redmine.example.com/issue_statuses.json"
```

Alternatively, go to **Administration → Issue statuses**, open a status, and read its ID from the URL. For example, `/issue_statuses/2/edit` means the ID is `2`.

| Middleware field | Intended Redmine state |
|---|---|
| New | Newly created ticket |
| In Progress | Work is active |
| Feedback | More information is needed |
| Resolve | Ticket is ready for mitigation review |
| Closed | Review is complete and the ticket is closed |

> **Checkpoint 3:** The Redmine API test returns statuses, and all six priority IDs are written down. Custom status IDs are written down only if you need them.

### Step 3.7 — Redmine Workflow Status

To map Redmine ticket statuses to the middleware workflow states (New, In Progress, Feedback, Resolved, Closed), you must configure the status IDs in the Settings page.

The screenshot below shows the workflow transition rules from a Redmine test environment, showing the allowed transitions between statuses:

![Redmine Workflow Transitions](/docs/media__1781966150774.png)

The middleware uses these transitions to track ticket lifecycle:
- **New → In Progress**: Work has started on the vulnerability.
- **In Progress → Feedback**: More information is needed from another team.
- **In Progress → Resolved**: The fix has been applied.
- **Resolved → Feedback**: The middleware moves a ticket back to Feedback when mitigation review finds the vulnerability is still active in DefectDojo.
- **Resolved → Closed**: An admin confirms the mitigation via the Mitigation Review queue.

> [!WARNING]
> If your Redmine workflow does **not** allow the **Resolved → Feedback** transition, the automatic resolve-to-feedback flow will not work. When a Redmine ticket is marked Resolved but DefectDojo still shows the finding as active, the middleware attempts to move the ticket back to Feedback status. If this transition is blocked in Redmine, the status update will fail with a 422 error and the ticket will remain stuck in Resolved.

Ensure your Redmine workflow allows these transitions for the tracker and roles used by the middleware API user. If transitions are blocked, ticket status updates will fail with 422 errors.

---

## 4. Install and Start the Middleware

**You are here:** Prerequisites → DefectDojo → Redmine → **Install** → Sign in → Connect DefectDojo → Connect Redmine → Map → Sync → Verify

Open PowerShell in the repository root and generate a non-overwriting local
environment file:

```powershell
node scripts/generate-env.cjs
```

The generator is safe to rerun. It creates `.env` when missing, fills blank or
missing managed values, and replaces known unsafe auth placeholders. It does
not rotate non-empty database passwords unless you explicitly pass `--force`.

It creates strong database, JWT, service-token, and bootstrap administrator
secrets. Review `.env`, including:

```ini
GATEWAY_PORT=80

PG_DB=defectdojo_viewer
PG_USER=defectdojo
PG_PASSWORD=<strong-database-password>

AUTH_PG_DB=middleware_auth
AUTH_PG_USER=middleware_auth
AUTH_PG_PASSWORD=<different-strong-password>

JWT_SECRET=<random-string-at-least-32-characters>
AUTH_SERVICE_TOKEN=<another-long-random-string>
AUTH_BOOTSTRAP_ADMIN_PASSWORD=<strong-initial-admin-password>
```

> [!CAUTION]
> Do not use the example secrets on a shared or deployed system. Keep `.env` private.

Build and start the stack:

```powershell
docker compose up -d --build
```

The stack starts seven services: `gateway`, `hub`, `docs`, `defectdojo`, `wazuh`, `db`, and `auth-db`.

Check their state:

```powershell
docker compose ps
```

The first startup can take 30–60 seconds. If a service is still starting, wait and run the command again.

> **Checkpoint 4:** Every service is running and reports `healthy`.

If a service remains unhealthy after two minutes, inspect its logs:

```powershell
docker compose logs --tail=100
```

---

## 5. Log In and Verify the Bootstrap Administrator

**You are here:** Prerequisites → DefectDojo → Redmine → Install → **Sign in** → Connect DefectDojo → Connect Redmine → Map → Sync → Verify

1. Open `http://localhost` in your browser. If you changed `GATEWAY_PORT`, include that port.
2. Sign in with username `admin` and the generated `AUTH_BOOTSTRAP_ADMIN_PASSWORD`.
3. On the Hub, go to **Administration → User Management**.
4. Edit the `admin` user and set a strong new password.

> [!CAUTION]
> Store or rotate the bootstrap password according to your organization’s
> credential policy. Existing users are never overwritten on later starts.

> **Checkpoint 5:** You can sign out and sign back in with the new admin password.

---

## 6. Configure DefectDojo Connection

**You are here:** Prerequisites → DefectDojo → Redmine → Install → Sign in → **Connect DefectDojo** → Connect Redmine → Map → Sync → Verify

1. Return to the Hub and open the **DefectDojo Viewer** card.
2. In the sidebar, select **Settings**.
3. On the **Connection** tab, enter:

| Field | Value |
|---|---|
| DefectDojo URL | The base URL from Step 2 |
| DefectDojo API Key | The API v2 key from Step 2 |

4. Select **Save Configuration**.
5. Wait for the message **Configuration saved.**

> **Checkpoint 6:** Both DefectDojo connection values remain populated after saving.

---

## 7. Configure Redmine Connection

**You are here:** Prerequisites → DefectDojo → Redmine → Install → Sign in → Connect DefectDojo → **Connect Redmine** → Map → Sync → Verify

1. Stay on **Settings → Connection**.
2. Enter the **Redmine URL** and **API Key** collected in Step 3.
3. Select **Save Configuration** and wait for **Configuration saved.**
4. Confirm the API user can create and edit issues in the intended project.
5. Confirm the DefectDojo product name can be matched to the correct Redmine project.
6. If the project does not exist, either create it in Redmine now or grant the API user **Create Projects** permission.

> **Checkpoint 7:** Both Redmine connection values remain populated, you know where the first ticket should appear, and the API user can write there.

---

## 8. Configure Redmine Priority and Status Mapping

**You are here:** Prerequisites → DefectDojo → Redmine → Install → Sign in → Connect DefectDojo → Connect Redmine → **Map** → Sync → Verify

In **Settings**, open the **Redmine Status** tab.

### Enter the priorities

Copy the numeric IDs you recorded in Step 3.5 into:

- **Default Priority ID**
- **Priority ID: Critical**
- **Priority ID: High**
- **Priority ID: Medium**
- **Priority ID: Low**
- **Priority ID: Info**

### Choose the status behavior

- For standard Redmine status names, leave the status fields blank and let the middleware match them by name.
- For custom names, enter the IDs collected in Step 3.6 for **New**, **Feedback**, **In Progress**, **Resolve**, and **Closed**.

Set **Status poll interval** to:

- `60` for updates every minute;
- `300` for updates every five minutes; or
- `0` to disable automatic polling.

Select **Save Configuration** and wait for **Configuration saved.**

> **Checkpoint 8:** All six priority fields contain valid numeric Redmine IDs, and your status choice is saved.

---

## 9. Run Your First Sync

**You are here:** Prerequisites → DefectDojo → Redmine → Install → Sign in → Connect DefectDojo → Connect Redmine → Map → **Sync** → Verify

For the first run, use a small, predictable scope if possible.

1. Select **Dashboard** in the sidebar.
2. Select **Sync Findings**. This button is visible to administrators.
3. In **Sync All Pull Filters**, use:

| Filter | Recommended first-run value |
|---|---|
| Severity | Select one or two severities, or **All** for a small DefectDojo instance |
| Product IDs | One known product ID, or blank for all products |
| Engagement ID | Blank unless you want one engagement only |
| Active | **Yes** |
| Verified | **Any** |
| Mitigated | **No** |

4. Select **Pull & Sync**.
5. Keep the progress window open until it finishes.
6. Review the summary and any warnings, then select **Done**.

During the run, the middleware pulls DefectDojo findings, groups duplicates, finds or creates Redmine tickets, updates local ticket status, and checks mitigation state.

> **Checkpoint 9:** The progress window reaches completion without a failed phase.

---

## 10. Verify Everything Works

**You are here:** Prerequisites → DefectDojo → Redmine → Install → Sign in → Connect DefectDojo → Connect Redmine → Map → Sync → **Verify**

Check each result before calling the setup complete:

| Check | Where | Expected result |
|---|---|---|
| Dashboard | DefectDojo Viewer → Dashboard | Vulnerability, ticket workflow, and severity cards contain data |
| Findings | Dashboard or Findings page | Grouped findings show severity, title, and Redmine state |
| Tickets | Target Redmine project | New vulnerability tickets were created or existing tickets were matched |
| Sync history | Sidebar → Sync History | The latest run is successful and shows counts |
| Products | Sidebar → Products | Synced DefectDojo products are listed |

> **Setup complete:** All five checks pass. You can now widen the filters and run the normal sync scope.

### If a check fails

| Symptom | What to check |
|---|---|
| `http://localhost` does not open | Run `docker compose ps`; confirm `gateway` is healthy and the browser port matches `GATEWAY_PORT` |
| DefectDojo returns `401` | Replace an invalid or regenerated API key in **Settings → Connection** |
| DefectDojo returns `403` | Grant the API user access to the required products |
| Redmine returns `403` | Enable the REST API and check the user's project permissions |
| Redmine returns `422` | Check project access, project routing, tracker/workflow rules, and required fields |
| A local service cannot be reached | Replace `localhost` with `host.docker.internal` on Docker Desktop or the host IP on Linux |
| A container stays unhealthy | Run `docker compose logs --tail=100 SERVICE_NAME` |
| No tickets are created | Confirm Redmine write permissions and that the intended project exists or can be created |

After correcting a setting, save it and repeat **Step 9** with the same small scope.

---

## What to Do Next

Once the first sync is verified:

1. Create user accounts under **Hub → User Management**. Use **Admin** for operators and **Viewer** for read-only access.
2. Run **Sync Findings** after each scan cycle or on your team's agreed schedule.
3. Review items under **Mitigation Review** when Redmine says a ticket is resolved but DefectDojo still reports an active finding.
4. Use **Settings → Mapped Assets** to replace discovered host/IP values with recognizable asset names where useful.
5. Read the in-app documentation under **Hub → Docs** for the complete operating workflow.

## Quick Reference

| Resource | Default URL |
|---|---|
| Hub | `http://localhost/` |
| DefectDojo Viewer | `http://localhost/defectdojo/` |
| DefectDojo Settings | `http://localhost/defectdojo/#settings` |
| Wazuh Viewer | `http://localhost/wazuh/` |
| Documentation | `http://localhost/#docs` |

If `GATEWAY_PORT` is not `80`, replace `80` in every URL with your configured port.
