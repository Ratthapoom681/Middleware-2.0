const SYSTEM_ADMIN_ROLE_ID = 'system-administrator';
const VIEWER_ROLE_ID = 'viewer';

const PERMISSION_CATALOG = Object.freeze([
  {
    key: 'identity.users.manage',
    workspace: 'Identity',
    label: 'Manage users and security',
    description: 'Create, edit, suspend, reset passwords, and manage MFA for users.',
    systemOnly: true,
    sensitive: true,
    mutating: true,
    requires: []
  },
  {
    key: 'identity.roles.manage',
    workspace: 'Identity',
    label: 'Manage roles and access',
    description: 'Create roles, change permissions, assign access, and review access history.',
    systemOnly: true,
    sensitive: true,
    mutating: true,
    requires: []
  },
  {
    key: 'hub.settings.manage',
    workspace: 'Hub',
    label: 'Manage system and email settings',
    description: 'Configure SMTP delivery and other Hub-wide settings.',
    sensitive: true,
    mutating: true,
    requires: []
  },
  {
    key: 'defectdojo.vulnerabilities.view',
    workspace: 'DefectDojo',
    label: 'View vulnerabilities',
    description: 'View dashboards, companies, products, engagements, and findings within the user’s product scope.',
    mutating: false,
    productScoped: true,
    requires: []
  },
  {
    key: 'defectdojo.tickets.manage',
    workspace: 'DefectDojo',
    label: 'Manage Redmine tickets',
    description: 'Create, check, and update Redmine tickets for in-scope findings.',
    mutating: true,
    productScoped: true,
    requires: ['defectdojo.vulnerabilities.view']
  },
  {
    key: 'defectdojo.sync.run',
    workspace: 'DefectDojo',
    label: 'Run vulnerability sync',
    description: 'Pull findings and run DefectDojo-to-Redmine synchronization for in-scope products.',
    sensitive: true,
    mutating: true,
    productScoped: true,
    requires: ['defectdojo.vulnerabilities.view']
  },
  {
    key: 'defectdojo.sync_history.view',
    workspace: 'DefectDojo',
    label: 'View sync history',
    description: 'Review synchronization runs and results for in-scope products.',
    mutating: false,
    productScoped: true,
    requires: []
  },
  {
    key: 'defectdojo.mitigations.review',
    workspace: 'DefectDojo',
    label: 'Review mitigations',
    description: 'Review and decide mitigation requests for in-scope findings.',
    sensitive: true,
    mutating: true,
    productScoped: true,
    requires: ['defectdojo.vulnerabilities.view']
  },
  {
    key: 'defectdojo.data.manage',
    workspace: 'DefectDojo',
    label: 'Manage data and archives',
    description: 'Manage live-data policies, exports, archives, storage, and deletion workflows.',
    sensitive: true,
    mutating: true,
    productScoped: true,
    requires: ['defectdojo.vulnerabilities.view']
  },
  {
    key: 'defectdojo.logs.view',
    workspace: 'DefectDojo',
    label: 'View security logs',
    description: 'View application and access-monitoring logs.',
    mutating: false,
    requires: []
  },
  {
    key: 'defectdojo.logs.clear',
    workspace: 'DefectDojo',
    label: 'Clear security logs',
    description: 'Permanently clear application or access-monitoring logs.',
    sensitive: true,
    mutating: true,
    requires: ['defectdojo.logs.view']
  },
  {
    key: 'defectdojo.settings.manage',
    workspace: 'DefectDojo',
    label: 'Manage integrations and settings',
    description: 'Configure DefectDojo, Redmine, mappings, backups, and integration settings.',
    sensitive: true,
    mutating: true,
    requires: []
  },
  {
    key: 'docs.view',
    workspace: 'Documentation',
    label: 'View and export documents',
    description: 'Read and export published documentation.',
    mutating: false,
    requires: []
  },
  {
    key: 'docs.manage',
    workspace: 'Documentation',
    label: 'Edit and manage documents',
    description: 'Edit, import, hide, restore, and delete documentation.',
    sensitive: true,
    mutating: true,
    requires: ['docs.view']
  },
  {
    key: 'wazuh.view',
    workspace: 'Wazuh',
    label: 'View alerts, incidents, and agents',
    description: 'Open Wazuh dashboards and inspect alerts, incidents, and agents.',
    mutating: false,
    requires: []
  },
  {
    key: 'wazuh.incidents.manage',
    workspace: 'Wazuh',
    label: 'Create and manage incidents',
    description: 'Create incidents, change status, and add timeline notes.',
    mutating: true,
    requires: ['wazuh.view']
  },
  {
    key: 'wazuh.settings.manage',
    workspace: 'Wazuh',
    label: 'Manage Wazuh settings',
    description: 'Access and change Wazuh integration settings.',
    sensitive: true,
    mutating: true,
    requires: ['wazuh.view']
  }
].map(permission => Object.freeze({
  systemOnly: false,
  sensitive: false,
  mutating: false,
  productScoped: false,
  ...permission,
  requires: Object.freeze([...(permission.requires || [])])
})));

const PERMISSION_BY_KEY = new Map(PERMISSION_CATALOG.map(permission => [permission.key, permission]));
const ALL_PERMISSION_KEYS = Object.freeze(PERMISSION_CATALOG.map(permission => permission.key));
const ASSIGNABLE_PERMISSION_KEYS = Object.freeze(PERMISSION_CATALOG.filter(permission => !permission.systemOnly).map(permission => permission.key));
const VIEWER_PERMISSIONS = Object.freeze([
  'defectdojo.vulnerabilities.view',
  'docs.view',
  'wazuh.view'
]);

const normalizeText = value => String(value || '').trim();

const normalizeProductScope = (scope, fallbackProducts = [], legacyRole = '') => {
  const requested = scope && typeof scope === 'object' ? scope : {};
  const products = Array.from(new Set(
    (Array.isArray(requested.products) ? requested.products : fallbackProducts)
      .map(normalizeText)
      .filter(Boolean)
  ));
  let mode = normalizeText(requested.mode).toLowerCase();
  if (legacyRole === 'admin') mode = 'all';
  if (!['all', 'selected', 'none'].includes(mode)) mode = products.length > 0 ? 'selected' : 'none';
  return {
    mode,
    products: mode === 'selected' ? products : []
  };
};

const expandPermissionDependencies = keys => {
  const expanded = new Set();
  const visit = key => {
    if (expanded.has(key) || !PERMISSION_BY_KEY.has(key)) return;
    expanded.add(key);
    for (const required of PERMISSION_BY_KEY.get(key).requires) visit(required);
  };
  for (const key of Array.isArray(keys) ? keys : []) visit(normalizeText(key));
  return ALL_PERMISSION_KEYS.filter(key => expanded.has(key));
};

const normalizePermissionKeys = (keys, { allowSystemOnly = false } = {}) => {
  const expanded = expandPermissionDependencies(keys);
  return expanded.filter(key => allowSystemOnly || !PERMISSION_BY_KEY.get(key).systemOnly);
};

const getAccess = user => {
  const source = user && typeof user === 'object' ? user : {};
  const access = source.access && typeof source.access === 'object' ? source.access : {};
  const role = access.role && typeof access.role === 'object' ? access.role : {};
  const system = Boolean(role.system) || source.role === 'admin';
  const permissions = system
    ? [...ALL_PERMISSION_KEYS]
    : normalizePermissionKeys(
      Array.isArray(access.permissions)
        ? access.permissions
        : (Array.isArray(source.permissions) ? source.permissions : (source.role === 'viewer' ? VIEWER_PERMISSIONS : [])),
      { allowSystemOnly: false }
    );
  return {
    role: {
      id: normalizeText(role.id || source.roleId || (system ? SYSTEM_ADMIN_ROLE_ID : (source.role === 'viewer' ? VIEWER_ROLE_ID : ''))),
      name: normalizeText(role.name || source.roleName || (system ? 'System Administrator' : (source.role === 'viewer' ? 'Viewer' : 'No role'))),
      system
    },
    permissions,
    productScope: normalizeProductScope(
      access.productScope || source.productScope,
      source.products,
      system ? 'admin' : source.role
    )
  };
};

const hasPermission = (user, permissionKey) => {
  if (!PERMISSION_BY_KEY.has(permissionKey)) return false;
  const access = getAccess(user);
  return access.role.system || access.permissions.includes(permissionKey);
};

const isSystemAdmin = user => getAccess(user).role.system;

const hasWorkspaceAccess = (user, workspace) => {
  const access = getAccess(user);
  if (access.role.system) return true;
  const normalizedWorkspace = normalizeText(workspace).toLowerCase();
  return access.permissions.some(key => PERMISSION_BY_KEY.get(key)?.workspace.toLowerCase() === normalizedWorkspace);
};

const buildAccess = ({ role, permissions = [], productScope, products = [], legacyRole = '' } = {}) => {
  const normalizedRole = role && typeof role === 'object' ? role : {};
  const system = Boolean(normalizedRole.system) || normalizedRole.id === SYSTEM_ADMIN_ROLE_ID || legacyRole === 'admin';
  return {
    role: {
      id: normalizeText(normalizedRole.id || (system ? SYSTEM_ADMIN_ROLE_ID : VIEWER_ROLE_ID)),
      name: normalizeText(normalizedRole.name || (system ? 'System Administrator' : 'Viewer')),
      system
    },
    permissions: system ? [...ALL_PERMISSION_KEYS] : normalizePermissionKeys(permissions),
    productScope: normalizeProductScope(productScope, products, system ? 'admin' : legacyRole)
  };
};

module.exports = {
  SYSTEM_ADMIN_ROLE_ID,
  VIEWER_ROLE_ID,
  PERMISSION_CATALOG,
  PERMISSION_BY_KEY,
  ALL_PERMISSION_KEYS,
  ASSIGNABLE_PERMISSION_KEYS,
  VIEWER_PERMISSIONS,
  normalizeProductScope,
  expandPermissionDependencies,
  normalizePermissionKeys,
  getAccess,
  buildAccess,
  hasPermission,
  hasWorkspaceAccess,
  isSystemAdmin
};
