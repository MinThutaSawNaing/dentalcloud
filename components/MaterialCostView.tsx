import React, { useMemo, useState } from 'react';
import { ArrowLeftRight, Beaker, Package, Plus, RotateCw, Search, Stethoscope } from 'lucide-react';
import type { ClinicalRecord, Doctor, PaymentRecord, TreatmentCostType } from '../types';
import { formatCurrency, type Currency } from '../utils/currency';
import { toLocalISODate } from '../utils/auditLogFilters';
import { formatDoctorName } from '../utils/doctorName';
import { buildMaterialCostPaymentRows, type MaterialCostPaymentRow } from '../utils/materialCostPaymentRows';
import { api } from '../services/api';
import { auth } from '../services/auth';
import Pagination from './Pagination';
import PaymentMlsCostModal from './PaymentMlsCostModal';
import ProgressBar from './ProgressBar';

interface MaterialCostViewProps {
  records: ClinicalRecord[];
  doctors: Doctor[];
  paymentRecords: PaymentRecord[];
  loading: boolean;
  currency: Currency;
  canManageMaterials: boolean;
  onRefresh: () => void | Promise<void>;
  onCostsSaved?: (patientId?: string | null) => Promise<void> | void;
  syncProgress?: number | null;
}

type MaterialCostFilter = 'all' | 'tomorrow' | 'today' | 'custom';

const MaterialCostView: React.FC<MaterialCostViewProps> = ({ records, doctors, paymentRecords, loading, currency, canManageMaterials, onRefresh, onCostsSaved, syncProgress = null }) => {
  const tableScrollRef = React.useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [patientSearchTerm, setPatientSearchTerm] = useState('');
  const [doctorSearchTerm, setDoctorSearchTerm] = useState('');
  const [treatmentSearchTerm, setTreatmentSearchTerm] = useState('');
  const [materialFilter, setMaterialFilter] = useState<MaterialCostFilter>('today');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTableScrollable, setIsTableScrollable] = useState(false);
  const [editingRow, setEditingRow] = useState<MaterialCostPaymentRow | null>(null);
  const [recoveryWarning, setRecoveryWarning] = useState<string | null>(null);
  const recoveryAttempted = React.useRef(false);
  const todayKey = useMemo(() => toLocalISODate(new Date()), []);
  const tomorrowKey = useMemo(() => { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); return toLocalISODate(tomorrow); }, []);
  const [dateFrom, setDateFrom] = useState(todayKey);
  const [dateTo, setDateTo] = useState(todayKey);
  const isTodayRange = dateFrom === todayKey && dateTo === todayKey;
  const itemsPerPage = 10;

  const paymentRows = useMemo(() => buildMaterialCostPaymentRows(records, paymentRecords), [records, paymentRecords]);
  const filteredRows = useMemo(() => {
    const patientTerm = patientSearchTerm.trim().toLowerCase();
    const doctorTerm = doctorSearchTerm.trim().toLowerCase();
    const treatmentTerm = treatmentSearchTerm.trim().toLowerCase();
    return paymentRows.filter((row) => {
      if (dateFrom && row.date < dateFrom) return false;
      if (dateTo && row.date > dateTo) return false;
      const patientName = row.payment.patient_name || row.treatments[0]?.patient_name || '';
      const identity = `${patientName} ${row.treatments[0]?.patient_unique_id || ''} ${row.payment.patientId}`.toLowerCase();
      const doctors = row.doctorNames.join(' ').toLowerCase();
      const treatments = row.treatments.map((record) => record.description || '').join(' ').toLowerCase();
      return (!patientTerm || identity.includes(patientTerm)) && (!doctorTerm || doctors.includes(doctorTerm)) && (!treatmentTerm || treatments.includes(treatmentTerm));
    });
  }, [paymentRows, patientSearchTerm, doctorSearchTerm, treatmentSearchTerm, dateFrom, dateTo]);
  const paginatedRows = useMemo(() => showAll ? filteredRows : filteredRows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage), [filteredRows, currentPage, showAll]);

  React.useEffect(() => { setCurrentPage(1); }, [paymentRecords, patientSearchTerm, doctorSearchTerm, treatmentSearchTerm, dateFrom, dateTo, materialFilter]);
  React.useEffect(() => {
    if (!canManageMaterials || recoveryAttempted.current) return;
    const session = auth.getSession();
    if (!session?.userId || !session.staffAuthToken) return;
    recoveryAttempted.current = true;
    let cancelled = false;
    api.materialCosts.retryPendingCommissionRecalculations({
      userId: session.userId,
      authToken: session.staffAuthToken
    }).then(async (result) => {
      if (cancelled) return;
      if (result.failed > 0) setRecoveryWarning(`${result.failed} doctor commission update(s) still need retry.`);
      if (result.processed > 0) await onRefresh();
    }).catch((error) => {
      if (!cancelled) setRecoveryWarning(error instanceof Error ? error.message : 'Pending doctor commissions could not be refreshed.');
    });
    return () => { cancelled = true; };
  }, [canManageMaterials, onRefresh]);
  React.useEffect(() => {
    if (loading) { setIsTableScrollable(false); return; }
    const container = tableScrollRef.current;
    if (!container) return;
    const update = () => setIsTableScrollable(container.scrollWidth > container.clientWidth + 1);
    update();
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(container);
    const table = container.querySelector('table');
    if (table) observer?.observe(table);
    return () => { window.removeEventListener('resize', update); observer?.disconnect(); };
  }, [loading, filteredRows.length]);

  const handleRefresh = async () => {
    if (isRefreshing || loading) return;
    setIsRefreshing(true);
    try { await onRefresh(); }
    catch (error) { console.error('Failed to refresh MLS costs:', error); alert(error instanceof Error ? error.message : 'Unable to refresh MLS costs. Please try again.'); }
    finally { setIsRefreshing(false); }
  };
  const handleSaved = async () => { if (onCostsSaved) await onCostsSaved(editingRow?.payment.patientId || null); else await onRefresh(); };
  const changeFrom = (value: string) => { setDateFrom(value); if (dateTo && value > dateTo) setDateTo(value); setMaterialFilter('custom'); };
  const changeTo = (value: string) => { setDateTo(value); if (dateFrom && value < dateFrom) setDateFrom(value); setMaterialFilter('custom'); };
  const resetToday = () => { setDateFrom(todayKey); setDateTo(todayKey); setMaterialFilter('today'); };
  const changeFilter = (filter: MaterialCostFilter) => {
    setMaterialFilter(filter);
    if (filter === 'all') { setDateFrom(''); setDateTo(''); return; }
    const date = filter === 'tomorrow' ? tomorrowKey : todayKey;
    setDateFrom(date); setDateTo(date);
  };
  const filterOptions: Array<{ value: MaterialCostFilter; label: string }> = [{ value: 'all', label: 'All' }, { value: 'tomorrow', label: 'Tomorrow' }, { value: 'today', label: 'Today' }];

  const getPatientName = (row: MaterialCostPaymentRow) => row.payment.patient_name || row.treatments[0]?.patient_name || 'Unknown';
  const getCollected = (row: MaterialCostPaymentRow) => Number(row.payment.clearedAmount ?? row.payment.amount);
  const getTypedCost = (row: MaterialCostPaymentRow, type: TreatmentCostType) => Number(type === 'lab' ? row.payment.labTotal : type === 'special_doctor' ? row.payment.specialDoctorTotal : row.payment.materialTotal) || 0;
  const getTotalCost = (row: MaterialCostPaymentRow) => Number(row.payment.mlsTotal || 0);
  const getNetRevenue = (row: MaterialCostPaymentRow) => Math.max(0, getCollected(row) - getTotalCost(row));
  const getNetProfit = (row: MaterialCostPaymentRow) => getNetRevenue(row) - row.doctorEarnings;
  const renderBalance = (row: MaterialCostPaymentRow) => { const balance = Number(row.payment.remainingBalance || 0); return <span className={balance > 0 ? 'font-bold text-red-600' : 'font-semibold text-green-600'}>{balance > 0 ? formatCurrency(balance, currency) : 'Clear'}</span>; };
  const renderTreatments = (row: MaterialCostPaymentRow) => row.treatments.length > 0
    ? <div className="space-y-1">{row.treatments.map((record) => <div key={record.id} className="flex min-w-0 items-start gap-1.5"><span className="mt-0.5 shrink-0 text-green-600">&bull;</span><span className="min-w-0 break-words">{record.description || 'Treatment record'}</span></div>)}</div>
    : <span className="text-slate-400">No linked treatment</span>;
  const renderTypedCost = (row: MaterialCostPaymentRow, type: TreatmentCostType) => {
    const amount = getTypedCost(row, type);
    if (amount <= 0) return <span className="text-slate-400">-</span>;
    const lab = type === 'lab'; const special = type === 'special_doctor';
    return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-black ${lab ? 'border-violet-100 bg-violet-50 text-violet-700' : special ? 'border-amber-100 bg-amber-50 text-amber-700' : 'border-cyan-100 bg-cyan-50 text-cyan-700'}`}>{lab ? <Beaker size={13} /> : special ? <Stethoscope size={13} /> : <Package size={13} />}{formatCurrency(amount, currency)}</span>;
  };

  return <div className="w-full min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm animate-fade-in">
    <div className="border-b border-slate-200 bg-gradient-to-br from-slate-50 via-white to-[var(--hover-50)]/40">
      <div className="flex min-w-0 flex-col gap-4 p-3 sm:p-4 md:p-6 xl:flex-row xl:items-start xl:justify-between xl:gap-5">
        <div className="flex min-w-0 items-start gap-3"><div className="hidden h-11 w-11 items-center justify-center rounded-2xl border theme-accent-border theme-accent-soft-bg theme-accent-text sm:flex"><Package size={22} /></div><div className="min-w-0 flex-1">
          <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] theme-accent-text sm:text-[11px] sm:tracking-[0.24em]">Service Menu</p><h2 className="break-words text-xl font-bold text-slate-900 sm:text-2xl">MLS Costs</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500 sm:text-sm">Track MLS costs and doctor earnings for each collected payment.</p>
          <button type="button" onClick={() => void handleRefresh()} disabled={loading || isRefreshing} className="refresh-action-button mt-3 inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[var(--hover-300)]"><RotateCw size={14} className={`refresh-action-icon ${isRefreshing ? 'animate-spin' : ''}`} />{isRefreshing ? 'Refreshing...' : 'Refresh'}</button>
        </div></div>
        <div className="w-full min-w-0 space-y-3 xl:max-w-5xl"><div className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm"><div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:flex xl:flex-1 xl:flex-wrap xl:items-end">
            <div className="relative min-w-0 xl:w-52"><input type="text" placeholder="Patient name or ID" value={patientSearchTerm} onChange={(e) => setPatientSearchTerm(e.target.value)} className="w-full min-w-0 rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-800 shadow-sm focus:ring-2 focus:ring-[var(--hover-300)]" /><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /></div>
            <input type="text" placeholder="Doctor" value={doctorSearchTerm} onChange={(e) => setDoctorSearchTerm(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm xl:w-36" />
            <input type="text" placeholder="Treatment" value={treatmentSearchTerm} onChange={(e) => setTreatmentSearchTerm(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm xl:w-40" />
            <div className="grid min-w-0 grid-cols-2 gap-2"><label className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">From<input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => changeFrom(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-2.5 py-2.5 text-xs xl:w-36" /></label><label className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">To<input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => changeTo(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-2.5 py-2.5 text-xs xl:w-36" /></label><button type="button" onClick={resetToday} className={`col-span-2 min-h-10 rounded-xl border px-4 py-2.5 text-xs font-bold ${isTodayRange ? 'theme-accent-border theme-accent-soft-bg theme-accent-text' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>{isTodayRange ? 'Today' : 'Custom'}</button></div>
          </div>
          <div className="grid w-full grid-cols-3 rounded-xl border border-slate-200 bg-slate-50 p-1 sm:w-auto sm:min-w-[240px]">{filterOptions.map((item) => <button key={item.value} type="button" onClick={() => changeFilter(item.value)} className={`rounded-lg px-2 py-2 text-xs ${materialFilter === item.value ? 'bg-white font-bold theme-accent-text shadow-sm' : 'text-slate-600'}`}>{item.label}</button>)}</div>
        </div></div></div>
      </div>
    </div>

    {recoveryWarning && <div role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 sm:px-6">{recoveryWarning}</div>}
    {(loading || typeof syncProgress === 'number') ? <div className="px-4 py-10 sm:px-6"><ProgressBar progress={typeof syncProgress === 'number' ? syncProgress : null} label={loading ? 'Refreshing MLS payment rows…' : 'Loading MLS payment rows…'} /></div> : <>
      <div className="hidden xl:block">{isTableScrollable && <div className="flex items-center justify-between gap-3 border-b border-[var(--hover-100)] bg-[var(--hover-50)] px-6 py-2.5 text-xs font-semibold text-[var(--hover-800)]"><span className="flex items-center gap-2"><ArrowLeftRight size={16} />Scroll sideways to view all columns.</span><span>The Action column stays visible</span></div>}
        <div ref={tableScrollRef} role="region" aria-label="Payment MLS cost table" className="overflow-x-auto"><table className="min-w-[1480px] w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr>{['Payment Date', 'Patient', 'Clinician', 'Clinical Activity'].map((label) => <th key={label} className="px-6 py-4 text-left text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</th>)}{['Patient Balance', 'Collected Payment', 'Material Cost', 'Lab Cost', 'Special Doctor Cost', 'Total Cost', 'Net Receive', 'Doctor Earned', 'Net Profit', 'Action'].map((label) => <th key={label} className={`${label === 'Action' ? 'sticky right-0 z-20 border-l border-slate-200 bg-slate-50' : ''} px-6 py-4 text-right text-[11px] font-black uppercase tracking-[0.18em] text-slate-500`}>{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100 bg-white">{filteredRows.length === 0 ? <tr><td colSpan={14} className="px-6 py-12 text-center"><p className="text-sm font-semibold text-slate-600">No payment rows found</p><p className="mt-1 text-xs text-slate-400">Try another payment date range or clear the search fields.</p></td></tr> : paginatedRows.map((row) => <tr key={row.id} className="group border-l-4 border-[var(--hover-300)] transition-colors hover:bg-[var(--hover-50)]/30">
            <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500">{row.date}</td><td className="px-6 py-4"><p className="font-bold text-slate-900">{getPatientName(row)}</p><p className="mt-0.5 font-mono text-xs text-slate-400">{row.treatments[0]?.patient_unique_id || row.payment.patientId}</p></td><td className="px-6 py-4 text-sm text-slate-700">{row.doctorNames.length ? row.doctorNames.map((name) => formatDoctorName(name)).join(', ') : '-'}</td><td className="max-w-md px-6 py-4 text-sm text-slate-700">{renderTreatments(row)}</td><td className="px-6 py-4 text-right text-sm">{renderBalance(row)}</td><td className="px-6 py-4 text-right text-sm font-black text-blue-700">{formatCurrency(getCollected(row), currency)}</td><td className="px-6 py-4 text-right">{renderTypedCost(row, 'material')}</td><td className="px-6 py-4 text-right">{renderTypedCost(row, 'lab')}</td><td className="px-6 py-4 text-right">{renderTypedCost(row, 'special_doctor')}</td><td className="px-6 py-4 text-right text-sm font-black">{getTotalCost(row) > 0 ? formatCurrency(getTotalCost(row), currency) : '-'}</td><td className="px-6 py-4 text-right text-sm font-black text-teal-700">{formatCurrency(getNetRevenue(row), currency)}</td><td className="px-6 py-4 text-right text-sm font-bold text-emerald-700">{row.doctorEarnings > 0 ? formatCurrency(row.doctorEarnings, currency) : '-'}</td><td className={`px-6 py-4 text-right text-sm font-black ${getNetProfit(row) >= 0 ? 'text-slate-900' : 'text-red-600'}`}>{formatCurrency(getNetProfit(row), currency)}</td><td className="sticky right-0 z-10 min-w-[172px] border-l border-slate-100 bg-white px-6 py-4 text-right group-hover:bg-[var(--hover-50)]">{canManageMaterials ? <button type="button" onClick={() => setEditingRow(row)} className="inline-flex items-center gap-1 rounded-lg border border-[var(--hover-200)] bg-[var(--hover-50)] px-3 py-1.5 text-xs font-bold text-[var(--hover-700)] hover:bg-[var(--hover-100)]"><Package size={13} /><Plus size={12} />MLS Costs</button> : <span className="text-xs text-slate-400">No access</span>}</td>
          </tr>)}</tbody>
        </table></div>
      </div>
      <div className="space-y-3 bg-slate-50/70 p-3 sm:p-4 xl:hidden">{filteredRows.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center"><p className="text-sm font-semibold text-slate-600">No payment rows found</p></div> : paginatedRows.map((row) => <article key={`mobile-${row.id}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-l-4 border-[var(--hover-300)] p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-slate-900">{getPatientName(row)}</p><p className="mt-1 text-xs text-slate-500">{row.date} · {row.doctorNames.length ? row.doctorNames.map((name) => formatDoctorName(name)).join(', ') : '-'}</p></div><div className="rounded-lg bg-emerald-50 px-2.5 py-1 text-right text-emerald-700"><p className="text-[10px] font-bold uppercase">Net profit</p><p className="text-sm font-black">{formatCurrency(getNetProfit(row), currency)}</p></div></div><div className="mt-3 rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase text-slate-500">Clinical activity</p><div className="mt-1 text-sm">{renderTreatments(row)}</div></div>
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3"><div className="rounded-xl border p-3"><dt className="text-[10px] font-bold uppercase text-slate-500">Patient balance</dt><dd className="mt-1">{renderBalance(row)}</dd></div><div className="rounded-xl border border-blue-100 bg-blue-50 p-3"><dt className="text-[10px] font-bold uppercase text-blue-600">Collected payment</dt><dd className="mt-1 text-sm font-black text-blue-700">{formatCurrency(getCollected(row), currency)}</dd></div><div className="rounded-xl border border-cyan-100 bg-cyan-50 p-3"><dt className="text-[10px] font-bold uppercase text-cyan-700">Material cost</dt><dd className="mt-1">{renderTypedCost(row, 'material')}</dd></div><div className="rounded-xl border border-violet-100 bg-violet-50 p-3"><dt className="text-[10px] font-bold uppercase text-violet-700">Lab cost</dt><dd className="mt-1">{renderTypedCost(row, 'lab')}</dd></div><div className="rounded-xl border border-amber-100 bg-amber-50 p-3"><dt className="text-[10px] font-bold uppercase text-amber-700">Special doctor cost</dt><dd className="mt-1">{renderTypedCost(row, 'special_doctor')}</dd></div><div className="rounded-xl border border-teal-100 bg-teal-50 p-3"><dt className="text-[10px] font-bold uppercase text-teal-700">Net receive</dt><dd className="mt-1 text-sm font-black text-teal-700">{formatCurrency(getNetRevenue(row), currency)}</dd></div><div className="col-span-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 sm:col-span-3"><dt className="text-[10px] font-bold uppercase text-emerald-700">Doctor earned</dt><dd className="mt-1 text-sm font-black text-emerald-700">{row.doctorEarnings > 0 ? formatCurrency(row.doctorEarnings, currency) : '-'}</dd></div></dl>
        {canManageMaterials ? <button type="button" onClick={() => setEditingRow(row)} className="mt-3 flex min-h-10 w-full items-center justify-center gap-1 rounded-xl border border-[var(--hover-200)] bg-[var(--hover-50)] px-3 py-2 text-sm font-bold text-[var(--hover-700)]"><Package size={15} /><Plus size={13} />MLS Costs</button> : <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-center text-xs text-slate-400">No access to manage costs</p>}
      </div></article>)}</div>
    </>}
    {!loading && filteredRows.length > 0 && <Pagination totalItems={filteredRows.length} itemsPerPage={itemsPerPage} currentPage={currentPage} onPageChange={setCurrentPage} showAll={showAll} onToggleShowAll={() => setShowAll(!showAll)} />}
    <PaymentMlsCostModal payment={editingRow?.payment || null} treatments={editingRow?.treatments || []} doctors={doctors} currency={currency} onClose={() => setEditingRow(null)} onSaved={handleSaved} />
  </div>;
};

export default MaterialCostView;
