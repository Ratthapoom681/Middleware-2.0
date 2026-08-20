import { hasPermission } from '../../../../../packages/access-control/index.js';

export const getDefectDojoPath = user => {
  if (hasPermission(user, 'defectdojo.vulnerabilities.view')) return '/defectdojo/#dashboard';
  if (hasPermission(user, 'defectdojo.data.manage')) return '/defectdojo/#data-management';
  if (hasPermission(user, 'defectdojo.sync.run')) return '/defectdojo/#data-management?tab=sync';
  if (hasPermission(user, 'defectdojo.sync_history.view')) return '/defectdojo/#sync-history';
  if (hasPermission(user, 'defectdojo.logs.view')) return '/defectdojo/#log-monitor';
  if (hasPermission(user, 'defectdojo.mitigations.review')) return '/defectdojo/#mitigation-review';
  if (hasPermission(user, 'defectdojo.settings.manage')) return '/defectdojo/#settings';
  return '/defectdojo/';
};
