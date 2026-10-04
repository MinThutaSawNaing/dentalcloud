import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClinicalRecord, PaymentRecord } from '../types';
import MaterialCostView from './MaterialCostView';
import { api } from '../services/api';
import { auth } from '../services/auth';

// Replace service modules entirely: no live Supabase client is imported.
vi.mock('../services/api', () => ({
  api: { materialCosts: { retryPendingCommissionRecalculations: vi.fn() } },
}));
vi.mock('../services/auth', () => ({ auth: { getSession: vi.fn() } }));
// The child has its own data-loading lifecycle; this suite tests only the view.
vi.mock('./PaymentMlsCostModal', () => ({ default: () => null }));

type Props = React.ComponentProps<typeof MaterialCostView>;
const today = '2026-06-15';
const record: ClinicalRecord = {
  id: 'synthetic-treatment', location_id: 'synthetic-branch',
  patient_id: 'synthetic-patient', patient_name: 'Synthetic MLS Patient',
  patient_unique_id: 'SYN-MLS-001', doctor_id: 'synthetic-doctor',
  doctor_name: 'Synthetic MLS Doctor', teeth: [16],
  description: 'Synthetic crown treatment', cost: 125000, date: today,
};
const payment: PaymentRecord = {
  id: 'synthetic-payment', location_id: record.location_id,
  patientId: record.patient_id, patient_name: record.patient_name,
  treatmentIds: [record.id], amount: 125000, clearedAmount: 125000,
  date: today, type: 'FULL', remainingBalance: 0,
  materialTotal: 7000, labTotal: 3000, specialDoctorTotal: 0,
  mlsTotal: 10000, netRevenue: 115000,
};
const props: Props = {
  records: [record], paymentRecords: [payment],
  doctors: [{ id: 'synthetic-doctor', name: 'Synthetic MLS Doctor',
    location_id: record.location_id, schedules: [], commission_percentage: 0 }],
  loading: false, currency: 'MMK', canManageMaterials: true,
  onRefresh: vi.fn(),
};
const render = (extra: Partial<Props> = {}) =>
  renderToStaticMarkup(React.createElement(MaterialCostView, { ...props, ...extra }));

function expectFilters(markup: string) {
  for (const placeholder of ['Patient name or ID', 'Doctor', 'Treatment']) {
    expect(markup).toContain(`placeholder="${placeholder}"`);
  }
  expect(markup.match(/type="date"/g)).toHaveLength(2);
  expect(markup.match(new RegExp(`value="${today}"`, 'g'))).toHaveLength(2);
  for (const label of ['All', 'Tomorrow', 'Today']) {
    expect(markup).toContain(`>${label}</button>`);
  }
}

function expectNoFinancialRows(markup: string) {
  expect(markup).not.toMatch(/<(?:table|tbody|tr|article)\b/);
  expect(markup).not.toContain('Payment MLS cost table');
  expect(markup).not.toContain('Synthetic MLS Patient');
  expect(markup).not.toContain('Synthetic crown treatment');
  expect(markup).not.toContain('125,000Ks');
  expect(markup).not.toContain('MLS Costs</button>');
  expect(markup).not.toContain('No payment rows found');
}

function expectReadyRows(markup: string) {
  expect(markup).toContain('aria-label="Payment MLS cost table"');
  const tbody = markup.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1];
  expect(tbody).toBeDefined();
  expect(tbody).toContain('Synthetic MLS Patient');
  expect(tbody).toContain('SYN-MLS-001');
  expect(tbody).toContain('Synthetic MLS Doctor');
  expect(tbody).toContain('Synthetic crown treatment');
  expect(tbody).toContain('125,000Ks');
  expect(tbody).toContain('10,000Ks');
  expect(tbody).toContain('MLS Costs</button>');
  expect(markup).toMatch(/<article\b/);
  expect(markup).not.toContain('No payment rows found');
  expect(markup).not.toContain('role="progressbar"');
  expect(markup).not.toContain('MLS syncs automatically.');
  expect(markup).not.toContain('role="alert"');
}

describe('MaterialCostView MLS sync UI (SSR)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Local noon keeps the fixture aligned with the default local Today filter.
    vi.setSystemTime(new Date(2026, 5, 15, 12));
  });
  afterEach(() => {
    vi.useRealTimers();
    // SSR does not run effects or trigger commission recovery/refresh requests.
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(api.materialCosts.retryPendingCommissionRecalculations).not.toHaveBeenCalled();
    expect(props.onRefresh).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([0, 35, 99])('shows numeric pending progress %i without financial rows or editing', (progress) => {
    const markup = render({ loading: true, syncProgress: progress });
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain(`aria-valuenow="${progress}"`);
    expect(markup).toContain(`>${progress}%</span>`);
    expect(markup).toContain(`style="width:${progress}%"`);
    expect(markup).toContain('Downloading MLS records…');
    expect(markup).not.toContain('progress-indeterminate-stripe');
    expectFilters(markup);
    expectNoFinancialRows(markup);
  });

  it.each([null, undefined])('shows indeterminate pending progress for %s', (syncProgress) => {
    const markup = render({ loading: true, syncProgress });
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('Preparing MLS sync…');
    expect(markup).toContain('progress-indeterminate-stripe');
    expect(markup).not.toContain('aria-valuenow');
    expect(markup).not.toMatch(/>\d+%<\/span>/);
    expectFilters(markup);
    expectNoFinancialRows(markup);
  });


  it.each([false, true])('shows error and enabled Retry instead of rows (loading=%s)', (loading) => {
    const markup = render({ loading, syncProgress: 35, loadError: 'Synthetic sync failure' });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Could not sync MLS data.');
    expect(markup).toContain('Synthetic sync failure');
    const retry = (markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [])
      .filter((button) => button.includes('>Retry</button>'));
    expect(retry).toHaveLength(1);
    expect(retry[0]).not.toContain('disabled');
    expect(markup).not.toContain('role="progressbar"');
    expect(markup).not.toContain('MLS syncs automatically.');
    expectFilters(markup);
    expectNoFinancialRows(markup);
  });

  it('shows the actual table when loading completes even with numeric syncProgress=100', () => {
    const markup = render({ loading: false, syncProgress: 100, loadError: null });
    expectReadyRows(markup);
    expectFilters(markup);
    expect(markup).not.toContain('Syncing MLS payment rows…');
    expect(markup).not.toContain('Preparing MLS sync…');
  });

  it('replaces the misleading 99% with an explicit financial-check stage', () => {
    const markup = render({ loading: true, syncProgress: 99, finalizing: true });
    expect(markup).toContain('Loading doctor commissions and MLS cost totals');
    expect(markup).toContain('progress-indeterminate-stripe');
    expect(markup).not.toContain('aria-valuenow');
    expect(markup).not.toContain('99%');
    expect(markup).toContain('table will open automatically');
    expectNoFinancialRows(markup);
    expectReadyRows(render({ loading: false, syncProgress: 100, finalizing: false }));
  });

  it('defaults omitted sync/error props to ready rows with the Today filter', () => {
    const markup = render();
    expectReadyRows(markup);
    expectFilters(markup);
  });

  it('shows an empty message only when ready data is genuinely empty', () => {
    const markup = render({ records: [], paymentRecords: [] });
    expect(markup).toContain('Payment MLS cost table');
    expect(markup).toContain('No payment rows found');
    expect(markup).not.toContain('role="progressbar"');
    expect(markup).not.toContain('MLS Costs</button>');
  });
});
