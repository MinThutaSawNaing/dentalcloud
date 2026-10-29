import React, { useState, useMemo } from 'react';
import { Plus, Edit2, Trash2, Loader2, User, Shield, UserCheck, FileDown, RotateCw } from 'lucide-react';
import { User as UserType } from '../types';
import { Modal } from './Shared';
import Pagination from './Pagination';
import { FLEXIBLE_STAFF_TABS } from '../constants';
import { resolveAllowedTabs } from '../utils/permissions';

interface UsersViewProps {
  users: UserType[];
  loading: boolean;
  isAdmin: boolean;
  onAdd: () => void;
  onEdit: (user: UserType) => void;
  onDelete: (id: string) => void;
  onRefresh?: () => void | Promise<void>;
}

const UsersView: React.FC<UsersViewProps> = ({
  users,
  loading,
  isAdmin,
  onAdd,
  onEdit,
  onDelete,
  onRefresh
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [pendingDeleteUser, setPendingDeleteUser] = useState<UserType | null>(null);
  const itemsPerPage = 100;

  // Filtered data based on search term
  const filteredUsers = useMemo(() => {
    if (!searchTerm) return users;
    const term = searchTerm.toLowerCase();
    return users.filter(user => 
      user.username.toLowerCase().includes(term) ||
      user.role.toLowerCase().includes(term) ||
      resolveAllowedTabs(user.role, user.allowed_tabs).some(tab => {
        const match = FLEXIBLE_STAFF_TABS.find(item => item.key === tab);
        return match?.label.toLowerCase().includes(term);
      })
    );
  }, [users, searchTerm]);

  // Paginated data
  const paginatedUsers = useMemo(() => {
    if (showAll) return filteredUsers;
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredUsers.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredUsers, currentPage, showAll]);

  // Reset to first page when users change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [users]);

  const handleDownloadCSV = () => {
    const csv = ['Username,Role,Tab Access,Created',
      ...users.map(u => {
        const tabSummary = u.role === 'admin'
          ? 'Full access'
          : resolveAllowedTabs(u.role, u.allowed_tabs)
              .map(tab => FLEXIBLE_STAFF_TABS.find(item => item.key === tab)?.label || tab)
              .join(' | ');
        return `"${u.username}","${u.role}","${tabSummary}","${u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A'}"`;
      })].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `users-report-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getRoleBadge = (role: 'admin' | 'normal') => {
    if (role === 'admin') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700">
          <Shield size={12} />
          Manager
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-700">
        <UserCheck size={12} />
        Normal
      </span>
    );
  };

  const renderUserActions = (user: UserType) => (
    <div className="flex justify-end gap-2">
      <button
        onClick={() => onEdit(user)}
        className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
        title="Edit user"
      >
        <Edit2 className="w-4 h-4" />
      </button>
      <button
        onClick={() => setPendingDeleteUser(user)}
        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        title="Delete user"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );

  const renderTabAccess = (user: UserType) => (
    user.role === 'admin' ? (
      <span className="text-sm font-medium text-gray-700">Full access</span>
    ) : (
      <div className="flex flex-wrap gap-1.5">
        {resolveAllowedTabs(user.role, user.allowed_tabs).map(tab => {
          const match = FLEXIBLE_STAFF_TABS.find(item => item.key === tab);
          return (
            <span
              key={`${user.id}-${tab}`}
              className="inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700"
            >
              {match?.label || tab}
            </span>
          );
        })}
      </div>
    )
  );

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden animate-fade-in">
      <div className="p-4 sm:p-6 border-b border-gray-100 flex flex-col gap-4 bg-white sticky top-0 z-10 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-gray-800">User Management</h2>
          <p className="text-sm text-gray-500">Manage staff accounts and tab access permissions</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
          <div className="relative w-full sm:flex-1 lg:w-64">
            <input
              type="text"
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1); // Reset to first page when searching
              }}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => void onRefresh?.()}
                className="refresh-action-button flex flex-1 items-center justify-center gap-2 border px-4 py-2 rounded-lg text-sm font-bold sm:flex-initial"
              >
                <RotateCw className="refresh-action-icon w-4 h-4" /> Refresh
              </button>
              <button
                onClick={handleDownloadCSV}
                disabled={users.length === 0}
                className="flex flex-1 items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed sm:flex-initial"
              >
                <FileDown className="w-4 h-4" /> Export CSV
              </button>
              <button
                onClick={onAdd}
                className="flex flex-1 items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors sm:flex-initial"
              >
                <Plus className="w-4 h-4" /> Add User
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-12 flex justify-center">
          <Loader2 className="animate-spin text-[var(--hover-600)]" />
        </div>
      ) : users.length === 0 ? (
        <div className="p-12 text-center text-gray-400 italic">
          No users found. {isAdmin && 'Add your first user to begin.'}
        </div>
      ) : (
        <div className="p-4 sm:p-6">
          <div role="region" aria-label="Users table" tabIndex={0} className="table-scroll hidden md:block">
            <table className="min-w-[760px] w-full">
              <thead className="bg-white">
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 text-xs font-black text-gray-500 uppercase tracking-wider">Username</th>
                  <th className="text-left py-3 px-4 text-xs font-black text-gray-500 uppercase tracking-wider">Role</th>
                  <th className="text-left py-3 px-4 text-xs font-black text-gray-500 uppercase tracking-wider">Tab Access</th>
                  <th className="text-left py-3 px-4 text-xs font-black text-gray-500 uppercase tracking-wider">Created</th>
                  {isAdmin && (
                    <th className="text-right py-3 px-4 text-xs font-black text-gray-500 uppercase tracking-wider">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {paginatedUsers.map((user) => (
                  <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold">
                          {user.username.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-900">{user.username}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      {getRoleBadge(user.role)}
                    </td>
                    <td className="py-4 px-4">
                      {renderTabAccess(user)}
                    </td>
                    <td className="py-4 px-4 text-sm text-gray-600">
                      {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
                    </td>
                    {isAdmin && (
                      <td className="py-4 px-4">
                        {renderUserActions(user)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 md:hidden">
            {paginatedUsers.map((user) => (
              <div key={user.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-700">
                      {user.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-gray-900">{user.username}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        Created {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
                      </p>
                    </div>
                  </div>
                  {isAdmin && renderUserActions(user)}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {getRoleBadge(user.role)}
                  {renderTabAccess(user)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {!loading && users.length > 0 && (
        <Pagination
          totalItems={users.length}
          itemsPerPage={itemsPerPage}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          showAll={showAll}
          onToggleShowAll={() => setShowAll(!showAll)}
        />
      )}
      {pendingDeleteUser && (
        <Modal title="Delete User" onClose={() => setPendingDeleteUser(null)}>
          <div className="space-y-5">
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4">
              <p className="text-sm font-semibold text-red-900">
                Delete "{pendingDeleteUser.username}"?
              </p>
              <p className="mt-1 text-xs text-red-700">
                This account will lose access immediately and this action cannot be undone.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPendingDeleteUser(null)}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onDelete(pendingDeleteUser.id);
                  setPendingDeleteUser(null);
                }}
                className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700"
              >
                Delete User
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default UsersView;

