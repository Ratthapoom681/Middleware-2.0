import { formatBangkokIntl } from '../../shared/time.js';

export const EMPTY_USER = {
  username: '',
  email: '',
  fullName: '',
  company: '',
  department: '',
  roleId: '',
  productScopeMode: '',
  products: '',
  status: 'active',
  mfaProvider: 'disabled',
};

export const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];

export const normalize = value => String(value || '').trim().toLowerCase();

export const parseProducts = value => (
  String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
);

export const formatDate = value => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return formatBangkokIntl(date, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

export const formatLabel = value => {
  const text = String(value || '').replace(/[-_]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const getAccountStatus = user => (
  normalize(user?.accountStatus || user?.status || 'active') || 'active'
);

export const getPresenceStatus = user => {
  if (getAccountStatus(user) === 'suspended') return 'suspended';
  const presence = normalize(user?.presenceStatus || user?.status || 'offline');
  return ['online', 'offline'].includes(presence) ? presence : 'offline';
};

export const getUserProductScope = user => {
  if (user?.access?.productScope) return user.access.productScope;
  if (normalize(user?.role) === 'admin') return { mode: 'all', products: [] };
  const products = Array.isArray(user?.products) ? user.products : [];
  return { mode: products.length > 0 ? 'selected' : 'none', products };
};

export const getUserProducts = user => getUserProductScope(user).products || [];
export const getUserRoleId = user => (
  user?.access?.role?.id || user?.roleId || user?.role || 'viewer'
);
export const getUserRoleName = user => (
  user?.access?.role?.name || user?.roleName || formatLabel(user?.role || 'viewer')
);

export const getAccessStatus = user => {
  const mode = getUserProductScope(user).mode;
  if (mode === 'all') return 'unrestricted';
  return mode === 'selected' ? 'restricted' : 'none';
};

export const getAccessSummary = user => {
  const products = getUserProducts(user);
  const accessStatus = getAccessStatus(user);
  if (accessStatus === 'unrestricted') {
    return { title: 'All products', details: 'No product restriction' };
  }
  if (accessStatus === 'restricted') {
    const visible = products.slice(0, 3).join(', ');
    const extra = products.length > 3 ? ` +${products.length - 3}` : '';
    return {
      title: `${products.length} product${products.length === 1 ? '' : 's'}`,
      details: `${visible}${extra}`,
    };
  }
  return { title: 'No products', details: 'No app access' };
};

export const redirectAfterSelfSecurityChange = () => {
  localStorage.removeItem('middleware_token');
  localStorage.removeItem('middleware_user');
  window.location.replace('/login/?returnTo=%2F&notice=security-updated');
};

export const createUserDraft = user => ({
  username: user.username,
  email: user.email || '',
  fullName: user.fullName || '',
  company: user.company || '',
  department: user.department || '',
  roleId: getUserRoleId(user),
  productScopeMode: getUserProductScope(user).mode,
  products: getUserProducts(user).join(', '),
  status: getAccountStatus(user),
  mfaProvider: user.mfaProvider || 'disabled',
});
