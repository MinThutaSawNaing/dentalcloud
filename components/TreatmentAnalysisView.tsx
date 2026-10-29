import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BadgeDollarSign,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Search,
  Stethoscope,
  Users,
  X
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { ClinicalRecord } from '../types';
import { formatCurrency, type Currency } from '../utils/currency';
import { buildTreatmentAnalysis, type TreatmentAnalysisRow } from '../utils/treatmentAnalytics';

interface TreatmentAnalysisViewProps {
  records: ClinicalRecord[];
  currency: Currency;
  dateFrom: string;
  dateTo: string;
  locationName: string;
  loading?: boolean;
  error?: string;
  combineAcrossLocations?: boolean;
  onRetry: () => void;
  onBack: () => void;
}

type SortKey = 'count' | 'production' | 'averageValue' | 'uniquePatients' | 'name';

const formatRangeDate = (date: string): string => {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const TreatmentAnalysisView: React.FC<TreatmentAnalysisViewProps> = ({
  records,
  currency,
  dateFrom,
  dateTo,
  locationName,
  loading = false,
  error = '',
  combineAcrossLocations = false,
  onRetry,
  onBack
}) => {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('count');
  const analysis = useMemo(
    () => buildTreatmentAnalysis(records, { combineAcrossLocations }),
    [combineAcrossLocations, records]
  );

  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = query
      ? analysis.rows.filter((row) => row.name.toLocaleLowerCase().includes(query))
      : analysis.rows;

    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      return b[sortKey] - a[sortKey] || b.count - a.count || a.name.localeCompare(b.name);
    });
  }, [analysis.rows, search, sortKey]);

  const topTreatments = analysis.rows.slice(0, 8);
  const topDoctors = analysis.doctors.slice(0, 8);
  const topTeeth = analysis.teeth.slice(0, 12);
  const maxCount = Math.max(...analysis.rows.map((row) => row.count), 1);
  const repeatRate = analysis.uniquePatients > 0 ? (analysis.repeatPatients / analysis.uniquePatients) * 100 : 0;

  const renderTreatmentRow = (row: TreatmentAnalysisRow, index: number) => (
    <tr key={row.key} className="group border-b border-slate-100 last:border-0 hover:bg-slate-50/80">
      <td className="py-4 pl-4 pr-3 sm:pl-5">
        <div className="flex min-w-[220px] items-center gap-3">
          <span className="w-6 flex-none font-mono text-xs font-bold tabular-nums text-slate-400">
            {String(index + 1).padStart(2, '0')}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-900" title={row.name}>{row.name}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
              <div
                className="h-full rounded-full bg-[var(--hover-600)] transition-[width]"
                style={{ width: `${Math.max((row.count / maxCount) * 100, 2)}%` }}
              />
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-4 text-right font-mono text-base font-black tabular-nums text-slate-900">{row.count.toLocaleString()}</td>
      <td className="px-3 py-4 text-right font-mono text-sm font-semibold tabular-nums text-slate-700">{row.uniquePatients.toLocaleString()}</td>
      <td className="px-3 py-4 text-right font-mono text-sm font-semibold tabular-nums text-emerald-700">{formatCurrency(row.production, currency)}</td>
      <td className="px-3 py-4 text-right font-mono text-sm tabular-nums text-slate-600">{formatCurrency(row.averageValue, currency)}</td>
      <td className="px-3 py-4 text-right text-sm text-slate-600">
        <span className="font-mono tabular-nums">{row.discountedCount}</span>
        <span className="mx-1 text-slate-300">/</span>
        <span className="font-mono tabular-nums">{row.focCount}</span>
      </td>
      <td className="px-3 py-4 text-right font-mono text-sm tabular-nums text-slate-600">{row.doctorCount}</td>
      <td className="py-4 pl-3 pr-4 text-right font-mono text-sm tabular-nums text-slate-600 sm:pr-5">{row.share.toFixed(1)}%</td>
    </tr>
  );

  return (
    <section className="space-y-6 animate-fade-in" aria-labelledby="treatment-analysis-title">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 text-white shadow-sm">
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <button
              type="button"
              onClick={onBack}
              className="mb-6 inline-flex items-center gap-2 rounded-lg text-sm font-bold text-slate-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to overview
            </button>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-indigo-300">Treatment intelligence</p>
            <h2 id="treatment-analysis-title" className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Treatment Analysis</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Every recorded procedure for <span className="font-bold text-white">{locationName}</span>, grouped by treatment and measured across the selected period.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-200 lg:justify-end">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-2">
              <CalendarDays className="h-3.5 w-3.5 text-indigo-300" aria-hidden="true" />
              {formatRangeDate(dateFrom)}{dateFrom !== dateTo ? ` — ${formatRangeDate(dateTo)}` : ''}
            </span>
            {loading && <span className="rounded-full border border-indigo-300/30 bg-indigo-400/10 px-3 py-2 text-indigo-200">Refreshing data…</span>}
          </div>
        </div>
        <div className="grid border-t border-white/10 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Performed', value: analysis.totalTreatments.toLocaleString(), note: `${analysis.rows.length} treatment types`, icon: <Stethoscope className="h-4 w-4" /> },
            { label: 'Patients treated', value: analysis.uniquePatients.toLocaleString(), note: `${repeatRate.toFixed(0)}% had multiple treatment records`, icon: <Users className="h-4 w-4" /> },
            { label: 'Production', value: formatCurrency(analysis.production, currency), note: 'Recorded treatment value', icon: <CircleDollarSign className="h-4 w-4" /> },
            { label: 'Average value', value: formatCurrency(analysis.averageValue, currency), note: `${analysis.discountedCount} discounted · ${analysis.focCount} FOC`, icon: <BadgeDollarSign className="h-4 w-4" /> }
          ].map((metric) => (
            <div key={metric.label} className="border-b border-white/10 p-5 last:border-b-0 sm:[&:nth-child(odd)]:border-r xl:border-b-0 xl:border-r xl:last:border-r-0">
              <div className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                <span>{metric.label}</span>
                <span className="text-indigo-300">{metric.icon}</span>
              </div>
              <p className="mt-3 break-words font-mono text-2xl font-black tabular-nums text-white">{loading || error ? '—' : metric.value}</p>
              <p className="mt-1 text-xs text-slate-400">{loading ? 'Loading selected period' : error ? 'Data unavailable' : metric.note}</p>
            </div>
          ))}
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-white px-6 py-14 text-center shadow-sm">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
            <X className="h-6 w-6" aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-base font-bold text-slate-900">Treatment analysis could not be loaded</h3>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">{error}</p>
          <button type="button" onClick={onRetry} className="mt-5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
            Try again
          </button>
        </div>
      ) : loading ? (
        <div aria-live="polite" aria-busy="true" className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
          <span className="mx-auto block h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600" />
          <p className="mt-4 text-sm font-bold text-slate-700">Loading every treatment in this period…</p>
          <p className="mt-1 text-xs text-slate-500">Large date ranges may take a moment.</p>
        </div>
      ) : analysis.totalTreatments === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <Stethoscope className="h-6 w-6" aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-base font-bold text-slate-900">No treatments in this period</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Return to Overview and choose a wider date range. Recorded treatments will be analyzed here automatically.</p>
          <button type="button" onClick={onBack} className="mt-5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
            Change date range
          </button>
        </div>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5 flex flex-col gap-1">
                <h3 className="text-lg font-bold text-slate-900">Procedure frequency over time</h3>
                <p className="text-xs text-slate-500">Only dates with treatment activity are plotted.</p>
              </div>
              <div className="h-[280px] min-h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analysis.trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="treatmentFrequencyFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={28} tick={{ fill: '#64748b', fontSize: 11 }} />
                    <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} />
                    <Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ''} formatter={(value: number | undefined) => [value ?? 0, 'Treatments']} />
                    <Area type="monotone" dataKey="count" stroke="#4f46e5" strokeWidth={2.5} fill="url(#treatmentFrequencyFill)" activeDot={{ r: 5 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h3 className="text-lg font-bold text-slate-900">Most performed</h3>
              <p className="mt-1 text-xs text-slate-500">Top treatments by recorded frequency.</p>
              <div className="mt-5 space-y-4">
                {topTreatments.slice(0, 5).map((row, index) => (
                  <div key={row.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3">
                    <span className="font-mono text-xs font-bold text-slate-400">{String(index + 1).padStart(2, '0')}</span>
                    <div className="min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-bold text-slate-800" title={row.name}>{row.name}</p>
                        <span className="font-mono text-xs text-slate-400">{row.share.toFixed(0)}%</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(row.count / maxCount) * 100}%` }} />
                      </div>
                    </div>
                    <span className="min-w-8 text-right font-mono text-lg font-black tabular-nums text-slate-900">{row.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
              <div>
                <h3 className="text-lg font-bold text-slate-900">All treatments</h3>
                <p className="mt-1 text-xs text-slate-500">One performance equals one saved treatment record. Patient counts are unique within each treatment.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="relative block">
                  <span className="sr-only">Search treatments</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search treatment" className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-9 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 sm:w-56" />
                  {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear treatment search" className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><X className="h-4 w-4" /></button>}
                </label>
                <label className="relative block">
                  <span className="sr-only">Sort treatments</span>
                  <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} className="w-full appearance-none rounded-lg border border-slate-300 bg-white py-2.5 pl-3 pr-9 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100">
                    <option value="count">Most performed</option>
                    <option value="production">Highest production</option>
                    <option value="averageValue">Highest average value</option>
                    <option value="uniquePatients">Most patients</option>
                    <option value="name">Treatment name</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                </label>
              </div>
            </div>
            {visibleRows.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-sm font-bold text-slate-700">No treatments match “{search.trim()}”</p>
                <button type="button" onClick={() => setSearch('')} className="mt-2 text-sm font-bold text-indigo-600 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Clear search</button>
              </div>
            ) : (
              <div role="region" aria-label="Treatment analysis table" tabIndex={0} className="table-scroll">
                <table className="w-full min-w-[1050px] text-left">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                    <tr>
                      <th className="py-3 pl-4 pr-3 sm:pl-5">Treatment</th>
                      <th className="px-3 py-3 text-right">Performed</th>
                      <th className="px-3 py-3 text-right">Patients</th>
                      <th className="px-3 py-3 text-right">Production</th>
                      <th className="px-3 py-3 text-right">Average</th>
                      <th className="px-3 py-3 text-right" title="Discounted / free-of-charge records">Discount / FOC</th>
                      <th className="px-3 py-3 text-right">Doctors</th>
                      <th className="py-3 pl-3 pr-4 text-right sm:pr-5">Share</th>
                    </tr>
                  </thead>
                  <tbody>{visibleRows.map(renderTreatmentRow)}</tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h3 className="text-lg font-bold text-slate-900">Treatments by doctor</h3>
              <p className="mt-1 text-xs text-slate-500">Record ownership, including treatments without an assigned doctor.</p>
              <div className="mt-4 h-[280px] min-h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topDoctors} layout="vertical" margin={{ left: 30, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                    <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={110} axisLine={false} tickLine={false} tick={{ fill: '#475569', fontSize: 11 }} />
                    <Tooltip formatter={(value: number | undefined) => [value ?? 0, 'Treatments']} />
                    <Bar dataKey="count" fill="#0f766e" radius={[0, 7, 7, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h3 className="text-lg font-bold text-slate-900">Most treated teeth</h3>
              <p className="mt-1 text-xs text-slate-500">How many treatment records included each tooth.</p>
              {topTeeth.length === 0 ? (
                <div className="flex h-[280px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-6 text-center text-sm text-slate-500">No tooth numbers were recorded in this period.</div>
              ) : (
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {topTeeth.map((item, index) => (
                    <div key={item.tooth} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-lg font-black text-slate-900">{item.tooth}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 font-mono text-xs font-bold text-slate-600 shadow-sm">{item.count}×</span>
                      </div>
                      <div className="mt-3 h-1 rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-amber-500" style={{ width: `${(item.count / topTeeth[0].count) * 100}%`, opacity: Math.max(1 - index * 0.055, 0.45) }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
};

export default TreatmentAnalysisView;