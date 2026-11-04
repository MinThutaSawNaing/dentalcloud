import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ExpensesLoadProgress, { createExpenseLoadStages } from './ExpensesLoadProgress';

describe('ExpensesLoadProgress', () => {
  it('shows unknown counts as loading, not fabricated row totals', () => {
    const markup = renderToStaticMarkup(<ExpensesLoadProgress stages={null} />);
    expect(markup).toContain('aria-valuenow="0"');
    expect(markup.match(/Loading…/g)).toHaveLength(3);
    expect(markup).toContain('Expenses and derived material costs');
    expect(markup).toContain('not elapsed time');
  });

  it('counts completed datasets including zero-row results and waits for publication', () => {
    const stages = createExpenseLoadStages();
    stages[1].count = 0;
    let markup = renderToStaticMarkup(<ExpensesLoadProgress stages={stages} />);
    expect(markup).toContain('aria-valuenow="33"');
    expect(markup).toContain('0 rows ready');
    stages[0].count = 1234;
    stages[2].count = 10;
    markup = renderToStaticMarkup(<ExpensesLoadProgress stages={stages} />);
    expect(markup).toContain('aria-valuenow="99"');
    expect(markup).toContain('1,234 rows ready');
    expect(markup).toContain('3 of 3 datasets ready');
  });
});