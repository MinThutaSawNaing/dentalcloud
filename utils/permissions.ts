import {
  ALL_APP_TAB_PERMISSIONS,
  DEFAULT_NORMAL_TAB_PERMISSIONS,
  FLEXIBLE_STAFF_TABS,
  FULL_ACCESS_TAB_PERMISSIONS,
  type AppTabPermission
} from '../constants';

const appTabPermissionSet = new Set<AppTabPermission>(ALL_APP_TAB_PERMISSIONS);
const flexibleStaffTabSet = new Set<AppTabPermission>(FLEXIBLE_STAFF_TABS.map(tab => tab.key));

export const sanitizeAllowedTabs = (tabs: unknown): AppTabPermission[] => {
  if (!Array.isArray(tabs)) {
    return [];
  }

  const sanitized = tabs.filter((tab): tab is AppTabPermission => {
    return typeof tab === 'string' && appTabPermissionSet.has(tab as AppTabPermission);
  });

  return Array.from(new Set(sanitized));
};

export const resolveAllowedTabs = (
  role: 'admin' | 'normal' | 'patient' | 'doctor' | undefined,
  tabs: unknown
): AppTabPermission[] => {
  if (role === 'admin') {
    return [...FULL_ACCESS_TAB_PERMISSIONS];
  }

  if (role === 'patient' || role === 'doctor') {
    return [];
  }

  if (!Array.isArray(tabs)) {
    return [...DEFAULT_NORMAL_TAB_PERMISSIONS];
  }

  return sanitizeAllowedTabs(tabs).filter(tab => flexibleStaffTabSet.has(tab));
};

export const hasTabAccess = (
  role: 'admin' | 'normal' | 'patient' | 'doctor' | undefined,
  tabs: unknown,
  tab: AppTabPermission
): boolean => {
  return resolveAllowedTabs(role, tabs).includes(tab);
};

export const canManageMaterialCosts = (
  role: 'admin' | 'normal' | 'patient' | 'doctor' | undefined,
  tabs: unknown
): boolean => {
  return role === 'admin' || (role === 'normal' && hasTabAccess(role, tabs, 'material-cost'));
};
