import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import RecordsView from './RecordsView';
import MaterialCostView from './MaterialCostView';
import { toLocalISODate } from '../utils/auditLogFilters';

vi.mock('../services/api', () => ({ api: { materialCosts: {} } }));
vi.mock('../services/auth', () => ({ auth: { getSession: vi.fn() } }));
vi.mock('./EditPaymentModal', () => ({ default: () => null }));
vi.mock('./PaymentMlsCostModal', () => ({ default: () => null }));

describe('directory compatibility and pagination recovery', () => {
  it('renders the legacy audit range with a query callback but without server rows', () => {
    const markup = renderToStaticMarkup(React.createElement(RecordsView, {
      records: [{ id: 't1', location_id: 'test-branch', patient_id: 'p1', patient_name: 'Legacy audit patient', date: toLocalISODate(new Date()), description: 'Compatibility crown', cost: 100, teeth: [] }],
      loading: false, onRefresh: vi.fn(), onDeleteAll: vi.fn(), currency: 'MMK',
      onQueryChange: vi.fn(), cacheScope: 'test-branch',
    }));
    expect(markup).toContain('Legacy audit patient');
    expect(markup).toContain('Compatibility crown');
  });

  it('keeps server pagination reachable when a page becomes empty after deletion', () => {
    const markup = renderToStaticMarkup(React.createElement(RecordsView, {
      records: [], displayRows: [], directoryMeta: { total: 101, counts: { appointments: 0, treatments: 101, payments: 0, reschedules: 0 } },
      loading: false, onRefresh: vi.fn(), onDeleteAll: vi.fn(), currency: 'MMK',
      onQueryChange: vi.fn(), cacheScope: 'test-branch',
    }));
    expect(markup).toContain('aria-label="Page 2"');
    for (const file of ['./MaterialCostView.tsx', './RecordsView.tsx']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source).toContain('if (currentPage > lastPage) setCurrentPage(lastPage)');
    }
  });

  it('restores MLS search inputs from the parent query on tab remount', () => {
    const markup = renderToStaticMarkup(React.createElement(MaterialCostView, {
      records: [], doctors: [], paymentRecords: [], loading: false, currency: 'MMK',
      canManageMaterials: false, onRefresh: vi.fn(), onQueryChange: vi.fn(), totalItems: 350,
      initialQuery: { page: 3, pageSize: 100, patientSearch: 'Restored patient', doctorSearch: 'Restored doctor', treatmentSearch: 'Restored crown', dateFrom: '2026-10-01', dateTo: '2026-10-31' },
    }));
    expect(markup).toContain('value="Restored patient"');
    expect(markup).toContain('value="Restored doctor"');
    expect(markup).toContain('value="Restored crown"');
    expect(markup).toContain('value="2026-10-01"');
  });
});