import accessControl from './index.cjs';

export const {
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
  isSystemAdmin,
} = accessControl;

export default accessControl;
