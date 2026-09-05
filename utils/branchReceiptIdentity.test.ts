import { describe, expect, it } from 'vitest';
import { normalizeBranchReceiptIdentity } from './branchReceiptIdentity';

describe('branch receipt identity', () => {
  it('normalizes a resolved branch identity and preserves its custom values', () => {
    expect(normalizeBranchReceiptIdentity({
      location_id: ' branch-1 ',
      location_name: ' Downtown Clinic ',
      location_address: ' 10 Main Road ',
      location_phone: ' 09-111 ',
      receipt_header_title: ' Downtown Official Receipt ',
      receipt_email: ' downtown@example.com ',
      custom_receipt_header_title: ' Downtown Official Receipt ',
      custom_receipt_email: ' downtown@example.com ',
      settings_updated_at: '2026-09-04T00:00:00Z'
    })).toEqual({
      locationId: 'branch-1',
      branchName: 'Downtown Clinic',
      address: '10 Main Road',
      phone: '09-111',
      headerTitle: 'Downtown Official Receipt',
      email: 'downtown@example.com',
      customHeaderTitle: 'Downtown Official Receipt',
      customEmail: 'downtown@example.com',
      usesGlobalTitle: false,
      usesGlobalEmail: false,
      settingsUpdatedAt: '2026-09-04T00:00:00Z'
    });
  });

  it('marks blank custom values as inherited while retaining resolved fallbacks', () => {
    expect(normalizeBranchReceiptIdentity({
      location_id: 'branch-2',
      location_name: 'North Clinic',
      location_address: null,
      location_phone: '09-222',
      receipt_header_title: 'My Dentist Receipt',
      receipt_email: 'office@example.com',
      custom_receipt_header_title: null,
      custom_receipt_email: null,
      settings_updated_at: null
    })).toMatchObject({
      locationId: 'branch-2',
      branchName: 'North Clinic',
      address: '',
      headerTitle: 'My Dentist Receipt',
      email: 'office@example.com',
      customHeaderTitle: '',
      customEmail: '',
      usesGlobalTitle: true,
      usesGlobalEmail: true
    });
  });

  it('rejects a missing or malformed branch response', () => {
    expect(() => normalizeBranchReceiptIdentity(null)).toThrow(/not found/i);
    expect(() => normalizeBranchReceiptIdentity({ location_id: '', location_name: '' })).toThrow(/not found/i);
  });
});