import { getUserRoleName } from './userHelpers.js';

export const USER_TABLE_COLUMNS = [
  { key: 'userId', label: 'ID', className: 'cell-user-id' },
  { key: 'username', label: 'Username', className: 'cell-username' },
  { key: 'fullName', label: 'Full Name', className: 'cell-full-name' },
  { key: 'email', label: 'Email', className: 'cell-email' },
  { key: 'company', label: 'Company', className: 'cell-company' },
  { key: 'department', label: 'Department', className: 'cell-department' },
  { key: 'role', label: 'Role', className: 'cell-role' },
];

export const getVisibleUserSearchText = user => [
  user.userId,
  user.username,
  user.fullName,
  user.email,
  user.company,
  user.department,
  getUserRoleName(user),
].join(' ').toLowerCase();
