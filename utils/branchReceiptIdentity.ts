import type { BranchReceiptIdentity } from '../types';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export const normalizeBranchReceiptIdentity = (row: unknown): BranchReceiptIdentity => {
  const value = row && typeof row === 'object' ? row as Record<string, unknown> : null;
  const locationId = text(value?.location_id);
  const branchName = text(value?.location_name);
  if (!locationId || !branchName) {
    throw new Error('Receipt identity branch was not found.');
  }

  const customHeaderTitle = text(value?.custom_receipt_header_title);
  const customEmail = text(value?.custom_receipt_email);
  return {
    locationId,
    branchName,
    address: text(value?.location_address),
    phone: text(value?.location_phone),
    headerTitle: text(value?.receipt_header_title) || branchName,
    email: text(value?.receipt_email),
    customHeaderTitle,
    customEmail,
    usesGlobalTitle: !customHeaderTitle,
    usesGlobalEmail: !customEmail,
    settingsUpdatedAt: text(value?.settings_updated_at) || null
  };
};