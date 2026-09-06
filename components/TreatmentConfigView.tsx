import React, { useState, useMemo } from 'react';
import { Plus, Edit2, Trash2, FileDown, RotateCw } from 'lucide-react';
import { TreatmentType } from '../types';
import { formatCurrency, Currency } from '../utils/currency';
import { getColorForCategory } from '../utils/colorUtils';
import Pagination from './Pagination';
import ProgressBar from './ProgressBar';

interface TreatmentConfigViewProps {
  treatmentTypes: TreatmentType[];
  currency: Currency;
  loading?: boolean;
  // Number (0-100) while the app's startup fetch is still bringing in the
  // treatment catalogue; null means the view can render normally.
  syncProgress?: number | null;
  onAdd: () => void;
  onEdit: (t: TreatmentType) => void;
  onDelete: (id: string) => void;
  onRefresh?: () => void | Promise<void>;
}

const TreatmentConfigView: React.FC<TreatmentConfigViewProps> = ({ treatmentTypes, currency, loading = false, syncProgress = null, onAdd, onEdit, onDelete, onRefresh }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const itemsPerPage = 10;

  const filteredTypes = useMemo(() => {
    if (!searchTerm) return treatmentTypes;
    const term = searchTerm.toLowerCase();
    return treatmentTypes.filter(type => 
      type.name.toLowerCase().includes(term) ||
      (type.category || '').toLowerCase().includes(term)
    );
  }, [treatmentTypes, searchTerm]);

  const paginatedTypes = useMemo(() => {
    if (showAll) return filteredTypes;
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredTypes.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredTypes, currentPage, showAll]);

  React.useEffect(() => { setCurrentPage(1); }, [treatmentTypes]);

  const handleDownloadPDF = () => {
    const csv = ['Service Name,Category,Standard Fee',
      ...treatmentTypes.map(t => `"${t.name}","${t.category || 'Uncategorized'}","${formatCurrency(t.cost || 0, currency)}"`)].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `treatment-catalogue-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
  <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden animate-fade-in">
    {/* Header */}
    <div className="p-4 md:p-6 border-b border-gray-100 bg-white">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <div className="min-w-0">
          <h2 className="text-lg md:text-xl font-bold text-gray-800">Treatment Catalogue</h2>
          <p className="text-xs md:text-sm text-gray-500 truncate">Configure clinical services and standard pricing</p>
        </div>
        <div className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3">
          <div className="relative w-full sm:w-auto">
            <input type="text" placeholder="Search..." value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="w-full sm:w-48 lg:w-64 pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void onRefresh?.()}
              disabled={loading}
              className="refresh-action-button inline-flex items-center gap-2 border px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-bold"
            >
              <RotateCw className="refresh-action-icon w-4 h-4 shrink-0" /> <span>Refresh</span>
            </button>
            <button onClick={handleDownloadPDF} disabled={treatmentTypes.length === 0}
              className="inline-flex items-center gap-2 bg-green-600 text-white px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <FileDown className="w-4 h-4 shrink-0" /> <span className="hidden sm:inline">Export CSV</span>
            </button>
            <button onClick={onAdd}
              className="inline-flex items-center gap-2 bg-indigo-600 text-white px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium hover:bg-indigo-700 whitespace-nowrap">
              <Plus className="w-4 h-4 shrink-0" /> <span>Add</span>
            </button>
          </div>
        </div>
      </div>
    </div>
      {(loading || typeof syncProgress === 'number') ? (
        <div className="px-6 py-12">
          <ProgressBar progress={typeof syncProgress === 'number' ? syncProgress : null} label={loading ? 'Refreshing service menu…' : 'Loading service menu…'} />
        </div>
      ) : (
        <>
    {/* Desktop table */}
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Service Name</th>
            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Specialty Category</th>
            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Standard Fee</th>
            <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-widest">Management</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {treatmentTypes.length === 0 ? (
            <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-400 italic">No treatment types configured. Add your first service to begin.</td></tr>
          ) : (paginatedTypes.map(t => {
            const categoryLabel = t.category || 'Uncategorized';
            return (<tr key={t.id} className="hover:bg-gray-50 transition-colors">
              <td className="px-6 py-4 font-bold text-gray-900">{t.name}</td>
              <td className="px-6 py-4">
                <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${getColorForCategory(categoryLabel)}`}>{categoryLabel}</span>
              </td>
              <td className="px-6 py-4 text-gray-900 font-black">{formatCurrency(t.cost || 0, currency)}</td>
              <td className="px-6 py-4 text-right space-x-2">
                <button onClick={() => onEdit(t)} className="text-gray-400 hover:text-indigo-600 transition-colors p-1"><Edit2 size={16} /></button>
                <button onClick={() => onDelete(t.id)} className="text-gray-400 hover:text-red-600 transition-colors p-1"><Trash2 size={16} /></button>
              </td>
            </tr>);
          }))}
        </tbody>
      </table>
    </div>
    {/* Mobile cards */}
    <div className="md:hidden divide-y divide-gray-100">
      {treatmentTypes.length === 0 ? (
        <div className="px-4 py-8 text-center text-gray-400 italic">No treatment types configured. Add your first service to begin.</div>
      ) : (paginatedTypes.map(t => {
        const categoryLabel = t.category || 'Uncategorized';
        return (<div key={t.id} className="px-4 py-4 hover:bg-gray-50 transition-colors">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-gray-900 text-sm truncate">{t.name}</h3>
              <span className={`mt-1.5 inline-block px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${getColorForCategory(categoryLabel)}`}>{categoryLabel}</span>
            </div>
            <div className="flex-shrink-0 text-right">
              <p className="text-gray-900 font-black text-sm">{formatCurrency(t.cost || 0, currency)}</p>
              <div className="mt-1.5 flex items-center justify-end gap-2">
                <button onClick={() => onEdit(t)} className="text-gray-400 hover:text-indigo-600 transition-colors p-0.5" aria-label="Edit"><Edit2 size={14} /></button>
                <button onClick={() => onDelete(t.id)} className="text-gray-400 hover:text-red-600 transition-colors p-0.5" aria-label="Delete"><Trash2 size={14} /></button>
              </div>
            </div>
          </div>
        </div>);
      }))}
    </div>
        {treatmentTypes.length > 0 && (
          <Pagination totalItems={treatmentTypes.length} itemsPerPage={itemsPerPage} currentPage={currentPage}
            onPageChange={setCurrentPage} showAll={showAll} onToggleShowAll={() => setShowAll(!showAll)} />
        )}
        </>
      )}
  </div>
  );
};

export default TreatmentConfigView;
