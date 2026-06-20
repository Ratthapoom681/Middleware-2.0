# Wazuh User Guide

Use this guide to navigate the Wazuh Viewer and review its dashboard, alerts, incidents, agents, and settings preview.

> [!NOTE]
> **Wazuh Viewer is currently a UI mockup.** It displays realistic sample data for demonstration purposes and does not connect to a live Wazuh Manager instance. All data shown exists only in the browser session and is not saved to a backend database. A future version will integrate with a real Wazuh deployment.

## Contents

1. [Use Wazuh Viewer](#use-wazuh-viewer)
2. [Current Limitations](#current-limitations)
3. [Future Integration](#future-integration)

## Use Wazuh Viewer

Wazuh Viewer is a mockup workspace. It uses mock frontend data and does not yet save to a backend.

To access Wazuh Viewer:
1. Log in to the Hub
2. Click the **Wazuh Viewer** card on the workspace selector
3. If the card shows **Offline**, the Wazuh container may need to be started (see troubleshooting in the Operations Guide)

The sidebar contains:

- **Dashboard**
- **Alerts**
- **Incidents**
- **Agents**
- **Settings**
- **Back to Hub**
- **Sign Out**

### Wazuh Dashboard

1. Open **Wazuh Viewer**.
2. Click **Dashboard**.
3. Review:
   - Security Alerts.
   - Active Incidents.
   - Active Agents.
   - Threat Level.
4. Review **Recent High-Severity Alerts**.
5. Click **View All Alerts** to open the Alerts page.
6. Click an alert row to open alert details.

### Alerts

1. Click **Alerts**.
2. Use severity tabs:
   - All
   - Low
   - Medium
   - High
   - Critical
3. Use the search box to search alerts, agents, or IPs.
4. Click an alert row.
5. Review description, agent, severity, rule ID, source IP, groups/signatures, and raw log event.
6. Click **Close**.

### Incidents

1. Click **Incidents**.
2. Filter by status:
   - All
   - Open
   - Investigating
   - Mitigating
   - Resolved
   - Closed
3. Click an incident row to open details.
4. Review the incident timeline.
5. Add a note in the update box and click **Post Update**.
6. Change **Status Workflow** when needed.
7. Click **Back to Incidents**.

### Create an Incident

1. Click **Incidents**.
2. Click **New Incident**.
3. Enter **Incident Title**.
4. Enter **Description / Context**.
5. Choose **Severity Level**.
6. Click **Create Incident**.

> [!IMPORTANT]
> Incidents created here exist only in the current browser session. Refreshing the page or logging out will reset the data to the default mock set.

### Agents

1. Click **Agents**.
2. Review agent cards.
3. Check agent ID, status, name, IP, OS, and version.

### Wazuh Settings

1. Click **Settings**.
2. Review the Wazuh Manager settings preview.

The settings page is locked as **Mockup Preview Only**. Backend settings will be active in a later integration phase.

## Current Limitations

- All data is mock/sample data generated in the browser.
- No connection to a real Wazuh Manager or Wazuh Indexer.
- Incidents and updates are not persisted between sessions.
- Settings cannot be modified (read-only preview).

## Future Integration

When real Wazuh integration is implemented, Wazuh Viewer will:
- Connect to a live Wazuh Manager API for real-time alert data.
- Persist incident states and notes to the backend database.
- Support configurable Wazuh Manager connection settings.
- Provide real agent status and monitoring data.
