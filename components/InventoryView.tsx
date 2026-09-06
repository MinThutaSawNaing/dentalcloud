import React, { useState, useMemo } from 'react';
import { Plus, Edit2, Trash2, Package, AlertTriangle, TrendingUp, BarChart3, RotateCw } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { Medicine } from '../types';
import { formatCurrency, Currency } from '../utils/currency';
import { exportInventoryToPDF } from '../utils/pdfExport';
import { exportInventoryToExcel } from '../utils/excelExport';
import Pagination from './Pagination';
import { ConfirmDialog } from './Shared';
import ExportMenu from './ExportMenu';
import ProgressBar from './ProgressBar';

interface TopSellingItem {
  medicine_id: string;
  medicine_name: string;
  total_quantity: number;
  total_revenue: number;
}

interface InventoryViewProps {
  medicines: Medicine[];
  topSelling: TopSellingItem[];
  loading: boolean;
  // Number (0-100) while the startup fetch is still bringing in the inventory.
  syncProgress?: number | null;
  currency: Currency;
  onAdd: () => void;
  onEdit: (medicine: Medicine) => void;
  onDelete: (id: string) => void;
  onRefresh?: () => void | Promise<void>;
}

const InventoryView: React.FC<InventoryViewProps> = ({
  medicines,
  topSelling,
  loading,
  syncProgress = null,
  currency,
  onAdd,
  onEdit,
  onDelete,
  onRefresh
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [medicineToDelete, setMedicineToDelete] = useState<{id: string, name: string} | null>(null);
  const itemsPerPage = 10;

  // Filtered data based on search term
  const filteredMedicines = useMemo(() => {
    if (!searchTerm) return medicines;
    const term = searchTerm.toLowerCase();
    return medicines.filter(medicine => 
      medicine.name.toLowerCase().includes(term) ||
      medicine.description?.toLowerCase().includes(term) ||
      medicine.category?.toLowerCase().includes(term) ||
      medicine.item_type?.toLowerCase().includes(term) ||
      medicine.unit.toLowerCase().includes(term)
    );
  }, [medicines, searchTerm]);

  // Paginated data
  const paginatedMedicines = useMemo(() => {
    if (showAll) return filteredMedicines;
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredMedicines.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredMedicines, currentPage, showAll]);

  // Reset to first page when medicines change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [medicines]);

  const handleDownloadPDF = () => {
    exportInventoryToPDF(medicines, currency);
  };

  const handleDownloadExcel = async () => {
    await exportInventoryToExcel(medicines, currency);
  };

  const getStockStatus = (stock: number, minStock?: number) => {
    if (minStock !== undefined && stock <= minStock) {
      return { color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', icon: <AlertTriangle size={14} /> };
    }
    if (stock === 0) {
      return { color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', icon: <AlertTriangle size={14} /> };
    }
    if (minStock !== undefined && stock <= minStock * 1.5) {
      return { color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200', icon: <AlertTriangle size={14} /> };
    }
    return { color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200', icon: null };
  };

  const formatQuantity = (value: number | undefined) => {
    const num = Number(value || 0);
    return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, '');
  };

  // Get low stock items for the chart
  const lowStockItems = useMemo(() => {
    return medicines
      .filter(m => m.min_stock !== undefined && m.stock <= m.min_stock * 1.5)
      .sort((a, b) => {
        const aRatio = a.min_stock ? a.stock / a.min_stock : 1;
        const bRatio = b.min_stock ? b.stock / b.min_stock : 1;
        return aRatio - bRatio;
      })
      .slice(0, 8)
      .map(m => ({
        name: m.name.length > 15 ? m.name.substring(0, 15) + '...' : m.name,
        stock: m.stock,
        minStock: m.min_stock || 0,
        percentage: m.min_stock ? Math.round((m.stock / m.min_stock) * 100) : 100
      }));
  }, [medicines]);

  // Colors for low stock chart
  const getLowStockColor = (percentage: number) => {
    if (percentage <= 50) return '#DC2626'; // Red for critical
    if (percentage <= 100) return '#F59E0B'; // Yellow for warning
    return '#10B981'; // Green for above min
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden animate-fade-in">
    <div className="p-6 border-b border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white sticky top-0 z-10">
      <div>
        <h2 className="text-xl font-bold text-gray-800">Inventory</h2>
        <p className="text-sm text-gray-500">Manage medicines and retail inventory items</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
        <div className="relative flex-1 sm:flex-initial">
          <input
            type="text"
            placeholder="Search inventory items..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1); // Reset to first page when searching
            }}
            className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full sm:w-64"
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void onRefresh?.()}
            className="refresh-action-button flex-1 sm:flex-initial flex items-center justify-center gap-2 border px-4 py-2 rounded-lg text-sm font-bold"
          >
            <RotateCw className="refresh-action-icon w-4 h-4" /> <span className="hidden sm:inline">Refresh</span>
          </button>
          <ExportMenu
            disabled={medicines.length === 0}
            onExportPDF={handleDownloadPDF}
            onExportExcel={handleDownloadExcel}
            className="flex-1 sm:flex-initial"
          />
          <button
            onClick={onAdd}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Add Item</span>
          </button>
        </div>
      </div>
    </div>

      {/* Reporting Charts Section */}
      {!loading && medicines.length > 0 && (
        <div className="p-6 border-b border-gray-100 bg-gray-50/50">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Most Selling Items Chart */}
            <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-indigo-100 rounded-lg">
                    <TrendingUp className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-800">Most Selling Items</h3>
                    <p className="text-xs text-gray-500">Top inventory items by sales quantity</p>
                  </div>
                </div>
              </div>
              <div className="h-[200px] w-full">
                {topSelling.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                    No sales data available
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topSelling.slice(0, 5)} layout="vertical" margin={{ left: 80, right: 20, top: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#E5E7EB" />
                      <XAxis type="number" hide />
                      <YAxis 
                        type="category" 
                        dataKey="medicine_name" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#6B7280', fontSize: 11 }} 
                        width={75}
                        tickFormatter={(value) => value.length > 12 ? value.substring(0, 12) + '...' : value}
                      />
                      <Tooltip 
                        formatter={(value: number | undefined, name: string | undefined, props: any) => [
                            `${formatQuantity(Number(value || 0))} units sold`,
                            props.payload.medicine_name
                          ]}
                        labelFormatter={() => ''}
                      />
                      <Bar dataKey="total_quantity" fill="#6366F1" radius={[0, 4, 4, 0]} barSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Low Stock Items Chart */}
            <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <BarChart3 className="w-4 h-4 text-amber-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-800">Low Stock Alert</h3>
                    <p className="text-xs text-gray-500">Items at or below minimum stock level</p>
                  </div>
                </div>
                {lowStockItems.length > 0 && (
                  <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-full">
                    {lowStockItems.filter(i => i.percentage <= 100).length} Critical
                  </span>
                )}
              </div>
              <div className="h-[200px] w-full">
                {lowStockItems.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-400">
                    <Package className="w-8 h-8 mb-2 text-green-400" />
                    <p className="text-sm">All items well stocked</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={lowStockItems} layout="vertical" margin={{ left: 80, right: 40, top: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#E5E7EB" />
                      <XAxis type="number" hide />
                      <YAxis 
                        type="category" 
                        dataKey="name" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#6B7280', fontSize: 11 }} 
                        width={75}
                      />
                      <Tooltip 
                        formatter={(value: number | undefined, name: string | undefined, props: any) => {
                          const item = props.payload;
                          return [`${item.stock} / ${item.minStock} units (${item.percentage}%)`, 'Stock Level'];
                        }}
                        labelFormatter={(label) => label}
                      />
                      <Bar dataKey="percentage" radius={[0, 4, 4, 0]} barSize={20}>
                        {lowStockItems.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={getLowStockColor(entry.percentage)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {(loading || typeof syncProgress === 'number') ? (
        <div className="p-8 sm:p-12">
          <ProgressBar progress={typeof syncProgress === 'number' ? syncProgress : null} label={loading ? 'Refreshing inventory…' : 'Loading inventory…'} />
        </div>
      ) : medicines.length === 0 ? (
        <div className="p-12 text-center text-gray-400 italic">
          No inventory items found. Add your first item to begin.
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Item</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Type</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Category</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Unit</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Price</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">Stock</th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginatedMedicines.map((medicine) => {
                  const status = getStockStatus(medicine.stock, medicine.min_stock);
                  return (
                    <tr key={medicine.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-indigo-100 rounded-lg">
                            <Package className="w-4 h-4 text-indigo-600" />
                          </div>
                          <div>
                            <div className="font-bold text-gray-900">{medicine.name}</div>
                            {medicine.description && (
                              <div className="text-xs text-gray-500 mt-0.5">{medicine.description}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 rounded text-xs font-medium bg-indigo-50 text-indigo-700">
                          {medicine.item_type || 'Medicine'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {medicine.category ? (
                          <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700">
                            {medicine.category}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-700 font-medium">{medicine.unit}</td>
                      <td className="px-6 py-4 text-gray-900 font-black">{formatCurrency(medicine.price || 0, currency)}</td>
                      <td className="px-6 py-4">
                        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold border ${status.bg} ${status.color} ${status.border}`}>
                          {status.icon}
                          {formatQuantity(medicine.stock)} {medicine.unit}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right space-x-2">
                        <button
                          onClick={() => onEdit(medicine)}
                          className="text-gray-400 hover:text-indigo-600 transition-colors p-1"
                          title="Edit item"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => {
                            setMedicineToDelete({ id: medicine.id, name: medicine.name });
                            setDeleteConfirmOpen(true);
                          }}
                          className="text-gray-400 hover:text-red-600 transition-colors p-1"
                          title="Delete item"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden divide-y divide-gray-100">
            {paginatedMedicines.map((medicine) => {
              const status = getStockStatus(medicine.stock, medicine.min_stock);
              return (
                <div key={medicine.id} className="p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-indigo-100 rounded-lg">
                        <Package className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div>
                        <div className="font-bold text-gray-900">{medicine.name}</div>
                        <div className="text-xs text-gray-500">{medicine.item_type || 'Medicine'} - {medicine.category || 'No Category'}</div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => onEdit(medicine)} className="p-2 text-indigo-600 bg-indigo-50 rounded-lg">
                        <Edit2 size={16} />
                      </button>
                      <button onClick={() => onDelete(medicine.id)} className="p-2 text-red-600 bg-red-50 rounded-lg">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1">Price / Unit</p>
                      <p className="text-sm font-black text-gray-900">{formatCurrency(medicine.price || 0, currency)} / {medicine.unit}</p>
                    </div>
                    <div className={`p-3 rounded-xl border ${status.bg} ${status.border}`}>
                      <p className={`text-[10px] uppercase font-bold tracking-wider mb-1 ${status.color}`}>Stock Level</p>
                      <div className={`text-sm font-black flex items-center gap-1.5 ${status.color}`}>
                        {status.icon}
                        {formatQuantity(medicine.stock)} {medicine.unit}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {!loading && medicines.length > 0 && (
        <Pagination
          totalItems={medicines.length}
          itemsPerPage={itemsPerPage}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          showAll={showAll}
          onToggleShowAll={() => setShowAll(!showAll)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title="Delete Item"
        message={`Are you sure you want to delete "${medicineToDelete?.name}"? This action cannot be undone.`}
        confirmText="Delete Item"
        cancelText="Cancel"
        type="danger"
        onConfirm={() => {
          if (medicineToDelete) {
            onDelete(medicineToDelete.id);
            setMedicineToDelete(null);
          }
          setDeleteConfirmOpen(false);
        }}
        onCancel={() => {
          setMedicineToDelete(null);
          setDeleteConfirmOpen(false);
        }}
      />
    </div>
  );
};

export default InventoryView;

