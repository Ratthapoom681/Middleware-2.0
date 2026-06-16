export const MOCK_INCIDENTS = [
  {
    id: 1,
    title: "Brute force SSH attack on web-server-01",
    severity: "high",
    status: "investigating",
    assignee: "admin",
    linkedAlerts: 15,
    createdAt: "2026-06-15T11:20:15Z",
    description: "Multiple failed SSH connection attempts detected from external IP 203.0.113.42 targeted at root and administrative accounts on web-server-01.",
    timeline: [
      { actor: "system", action: "created", time: "2026-06-15T11:20:15Z", message: "Auto-created from 15 SSH brute force alerts" },
      { actor: "admin", action: "status_change", time: "2026-06-15T11:25:00Z", message: "Changed status from 'open' to 'investigating'" },
      { actor: "admin", action: "note", time: "2026-06-15T11:30:12Z", message: "Blocked source IP 203.0.113.42 at the edge firewall. Verifying if any logins succeeded before block." }
    ]
  },
  {
    id: 2,
    title: "Web shell injection attempt on web-server-01",
    severity: "critical",
    status: "open",
    assignee: "admin",
    linkedAlerts: 1,
    createdAt: "2026-06-15T10:55:12Z",
    description: "Post request carrying shell execution keywords ('avatar.php?cmd=whoami') was processed by the web applications upload directory. Potential remote code execution vulnerability.",
    timeline: [
      { actor: "system", action: "created", time: "2026-06-15T10:55:12Z", message: "Alert wz-alert-009 triggered automated critical incident flow." }
    ]
  },
  {
    id: 3,
    title: "Mimikatz tool execution signature on desktop-01",
    severity: "high",
    status: "mitigating",
    assignee: "security_analyst",
    linkedAlerts: 1,
    createdAt: "2026-06-15T11:05:00Z",
    description: "VirusTotal integration triggered warning on user-desktop-01: 'mimikatz.exe' binary was downloaded and execution attempt was blocked by EDR.",
    timeline: [
      { actor: "system", action: "created", time: "2026-06-15T11:05:00Z", message: "Incident logged via VirusTotal webhook integration." },
      { actor: "security_analyst", action: "note", time: "2026-06-15T11:10:00Z", message: "Isolating user-desktop-01 from host network to prevent lateral movement. Initiating credential rotation." }
    ]
  },
  {
    id: 4,
    title: "Active Directory Account Lockout - target_employee",
    severity: "medium",
    status: "resolved",
    assignee: "helpdesk_lead",
    linkedAlerts: 2,
    createdAt: "2026-06-15T10:45:00Z",
    description: "Active Directory locked out account target_employee after 10 failed logon attempts from internal hosts.",
    timeline: [
      { actor: "system", action: "created", time: "2026-06-15T10:45:00Z", message: "Incident logged." },
      { actor: "helpdesk_lead", action: "note", time: "2026-06-15T10:58:00Z", message: "Spoke to the employee. They forgot to update their LDAP client credentials after password rotation. Unlocked AD account." },
      { actor: "helpdesk_lead", action: "status_change", time: "2026-06-15T11:00:00Z", message: "Marked incident as resolved." }
    ]
  }
];
