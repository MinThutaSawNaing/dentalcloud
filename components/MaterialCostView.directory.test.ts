import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { transpileModule, ScriptTarget } from 'typescript';
import MaterialCostView from './MaterialCostView';

vi.mock('../services/api', () => ({ api: { materialCosts: {} } }));
vi.mock('../services/auth', () => ({ auth: { getSession: vi.fn() } }));
vi.mock('./PaymentMlsCostModal', () => ({ default: () => null }));

describe('MLS database directory view', () => {
  it('uses the server count instead of treating the loaded page as the entire result', () => {
    const markup = renderToStaticMarkup(React.createElement(MaterialCostView, {
      records: [], paymentRecords: [], doctors: [], loading: false,
      currency: 'MMK', canManageMaterials: false, onRefresh: vi.fn(),
      onQueryChange: vi.fn(), totalItems: 350
    }));
    expect(markup).toContain('350');
    expect(markup).toContain('aria-label="Next page"');
    expect(markup).toContain('aria-label="Page 4"');
  });

  it('debounces filters, resets later pages, and does not reset on payment response changes', async () => {
    vi.useFakeTimers();
    try {
      const source = readFileSync(new URL('./MaterialCostView.tsx', import.meta.url), 'utf8');
      const start = source.indexOf('    const filtersChanged =');
      const end = source.indexOf('  }, [filterKey,', start);
      const body = transpileModule(source.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
      const callback = vi.fn();
      const setCurrentPage = vi.fn();
      const run = (page: number, previous: string) => new Function(
        'appliedFilterRef', 'filterKey', 'currentPage', 'setCurrentPage', 'onQueryChange',
        'dateFrom', 'dateTo', 'patientSearchTerm', 'doctorSearchTerm', 'treatmentSearchTerm', 'itemsPerPage', 'showAll',
        body
      )({ current: previous }, 'new', page, setCurrentPage, callback,
        '2026-11-01', '2026-11-03', ' Jane ', ' Smith ', ' Crown ', 100, false);
      run(3, 'old');
      expect(setCurrentPage).toHaveBeenCalledWith(1);
      await vi.runAllTimersAsync();
      expect(callback).not.toHaveBeenCalled();
      const cleanup = run(1, 'new');
      await vi.advanceTimersByTimeAsync(249);
      expect(callback).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(callback).toHaveBeenCalledWith({ dateFrom: '2026-11-01', dateTo: '2026-11-03',
        patientSearch: 'Jane', doctorSearch: 'Smith', treatmentSearch: 'Crown', page: 1, pageSize: 100, showAll: false });
      cleanup();
      expect(source).not.toContain('setCurrentPage(1); }, [paymentRecords');
    } finally { vi.useRealTimers(); }
  });
});