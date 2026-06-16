export const MOCK_ALERTS = [
  {
    id: "wz-alert-001",
    timestamp: "2026-06-15T11:42:10Z",
    agent: { id: "003", name: "web-server-01" },
    rule: { id: 5710, level: 10, description: "sshd: Attempt to login using a denied user." },
    severity: "high",
    groups: ["sshd", "authentication_failed"],
    srcIp: "203.0.113.42",
    status: "new",
    rawLog: "Jun 15 11:42:10 web-server-01 sshd[28491]: Invalid user admin from 203.0.113.42 port 54822 ssh2"
  },
  {
    id: "wz-alert-002",
    timestamp: "2026-06-15T11:40:05Z",
    agent: { id: "005", name: "database-core" },
    rule: { id: 5501, level: 7, description: "Login session failed: DB connection limit reached." },
    severity: "medium",
    groups: ["postgresql", "database_error"],
    srcIp: "10.0.2.14",
    status: "new",
    rawLog: "2026-06-15 11:40:05.123 UTC [9281] FATAL: sorry, too many clients already"
  },
  {
    id: "wz-alert-003",
    timestamp: "2026-06-15T11:35:18Z",
    agent: { id: "001", name: "wazuh-manager" },
    rule: { id: 1002, level: 2, description: "Wazuh agent started." },
    severity: "low",
    groups: ["wazuh", "agent_management"],
    srcIp: "127.0.0.1",
    status: "resolved",
    rawLog: "2026-06-15 11:35:18 wazuh-modulesd:agent-info: INFO: Agent 003 started."
  },
  {
    id: "wz-alert-004",
    timestamp: "2026-06-15T11:31:00Z",
    agent: { id: "003", name: "web-server-01" },
    rule: { id: 550, level: 12, description: "Integrity checksum changed: /etc/nginx/nginx.conf" },
    severity: "critical",
    groups: ["syscheck", "file_integrity"],
    srcIp: "10.0.1.5",
    status: "new",
    rawLog: "File '/etc/nginx/nginx.conf' checksum changed. Old: a4dfc19... New: 29bc4fe..."
  },
  {
    id: "wz-alert-005",
    timestamp: "2026-06-15T11:28:44Z",
    agent: { id: "007", name: "mail-server" },
    rule: { id: 31101, level: 9, description: "Web server 400 error code log check (possible scan)." },
    severity: "medium",
    groups: ["web", "access_denied"],
    srcIp: "198.51.100.77",
    status: "new",
    rawLog: "198.51.100.77 - - [15/Jun/2026:11:28:44 +0000] \"GET /admin/setup.php HTTP/1.1\" 404 162"
  },
  {
    id: "wz-alert-006",
    timestamp: "2026-06-15T11:20:15Z",
    agent: { id: "003", name: "web-server-01" },
    rule: { id: 5716, level: 13, description: "sshd: Multiple failed login attempts (possible brute force)." },
    severity: "critical",
    groups: ["sshd", "authentication_failures", "brute_force"],
    srcIp: "203.0.113.42",
    status: "new",
    rawLog: "Jun 15 11:20:15 web-server-01 sshd[28491]: pam_unix(sshd:auth): authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost=203.0.113.42  user=root"
  },
  {
    id: "wz-alert-007",
    timestamp: "2026-06-15T11:15:30Z",
    agent: { id: "009", name: "internal-dns" },
    rule: { id: 60112, level: 5, description: "DNS Query pattern matches abnormal tunneling signature." },
    severity: "high",
    groups: ["dns", "tunneling_detect"],
    srcIp: "10.0.3.11",
    status: "new",
    rawLog: "15-Jun-2026 11:15:30.491 queries: info: client @0x7f83a: query: 7a83d78fac91.tunnel.attacker.com IN TXT -E(0)K"
  },
  {
    id: "wz-alert-008",
    timestamp: "2026-06-15T11:05:00Z",
    agent: { id: "004", name: "user-desktop-01" },
    rule: { id: 87105, level: 8, description: "VirusTotal: Malicious file signature detected." },
    severity: "high",
    groups: ["virustotal", "malware"],
    srcIp: "10.20.1.112",
    status: "new",
    rawLog: "VirusTotal alert: File 'mimikatz.exe' detected as malicious by 48/62 engines. Path: C:\\Users\\user\\Downloads\\mimikatz.exe"
  },
  {
    id: "wz-alert-009",
    timestamp: "2026-06-15T10:55:12Z",
    agent: { id: "003", name: "web-server-01" },
    rule: { id: 31106, level: 11, description: "Web shell detection: php execution in upload folder." },
    severity: "critical",
    groups: ["web", "malware", "webshell"],
    srcIp: "198.51.100.12",
    status: "new",
    rawLog: "198.51.100.12 - - [15/Jun/2026:10:55:12 +0000] \"POST /uploads/images/avatar.php?cmd=whoami HTTP/1.1\" 200 48"
  },
  {
    id: "wz-alert-010",
    timestamp: "2026-06-15T10:45:00Z",
    agent: { id: "010", name: "ldap-directory" },
    rule: { id: 18152, level: 8, description: "LDAP: Active Directory account locked out." },
    severity: "high",
    groups: ["ldap", "active_directory", "account_lockout"],
    srcIp: "10.0.2.5",
    status: "resolved",
    rawLog: "Security Alert: A user account was locked out. Account Name: target_employee. Security ID: S-1-5-21-..."
  }
];
