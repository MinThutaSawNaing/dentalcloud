import React from 'react';
import ProgressBar from './ProgressBar';

export interface ExpenseLoadStage {
  label: string;
  count: number | null;
}

export const createExpenseLoadStages = (): ExpenseLoadStage[] => [
  { label: 'Expenses and derived material costs', count: null },
  { label: 'Medicine sales', count: null },
  { label: 'Treatment revenue', count: null },
];

export default function ExpensesLoadProgress({ stages }: { stages: ExpenseLoadStage[] | null }) {
  const reads = stages || createExpenseLoadStages();
  const completed = reads.filter(stage => stage.count !== null).length;
  // Completed datasets, not estimated time. Publication still has to finish.
  const percentage = Math.min(99, Math.floor(completed / reads.length * 100));
  return (
    <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6">
      <ProgressBar progress={percentage} label="Loading expenses" />
      <p className="mt-2 text-xs text-slate-500">{completed} of {reads.length} datasets ready · Progress measures completed stages, not elapsed time.</p>
      <ul className="mt-4 space-y-2 text-sm text-slate-600">
        {reads.map(stage => <li key={stage.label} className="flex justify-between gap-4">
          <span>{stage.label}</span>
          <span className="tabular-nums">{stage.count === null ? 'Loading…' : `${stage.count.toLocaleString()} rows ready`}</span>
        </li>)}
      </ul>
    </div>
  );
}