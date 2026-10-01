import { useContext, useEffect, useState } from 'react';
import { Check, Filter, LogOut, RefreshCw, Search, ShieldCheck, Users, X } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { API_URL } from '../config';
import { getValidToken } from '../utils/auth';

const EMPTY_OVERVIEW = {
  total_users: 0,
  total_students: 0,
  total_teachers: 0,
  pending_teachers: 0,
  total_admins: 0,
};

export default function AdminDashboard() {
  const { user, logout } = useContext(AuthContext);
  const [overview, setOverview] = useState(EMPTY_OVERVIEW);
  const [users, setUsers] = useState([]);
  const [pendingTeachers, setPendingTeachers] = useState([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null);
  const [error, setError] = useState('');

  const loadAdminData = async () => {
    const token = getValidToken();
    if (!token) return;

    setLoading(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const responses = await Promise.all([
        fetch(`${API_URL}/api/admin/overview`, { headers }),
        fetch(`${API_URL}/api/admin/users`, { headers }),
        fetch(`${API_URL}/api/admin/pending-teachers`, { headers }),
      ]);
      const failedResponse = responses.find((response) => !response.ok);
      if (failedResponse) {
        throw new Error(failedResponse.status === 403 ? 'Administrator authorization required.' : 'Unable to load administrator data.');
      }

      const [overviewData, usersData, pendingData] = await Promise.all(responses.map((response) => response.json()));
      setOverview(overviewData);
      setUsers(Array.isArray(usersData) ? usersData : []);
      setPendingTeachers(Array.isArray(pendingData) ? pendingData : []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role !== 'admin') return undefined;
    const refreshTimer = setTimeout(() => loadAdminData(), 0);
    return () => clearTimeout(refreshTimer);
  }, [user]);

  const reviewTeacher = async (teacherId, decision) => {
    const token = getValidToken();
    if (!token) return;

    setActionId(teacherId);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/admin/teachers/${teacherId}/${decision}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to update teacher status.');
      await loadAdminData();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setActionId(null);
    }
  };

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <ForbiddenState />;

  const filteredUsers = users.filter((account) => {
    const matchesSearch = `${account.full_name} ${account.email}`.toLowerCase().includes(search.toLowerCase());
    const matchesRole = roleFilter === 'all' || account.role === roleFilter;
    const matchesStatus = statusFilter === 'all' || account.account_status === statusFilter;
    return matchesSearch && matchesRole && matchesStatus;
  });

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600 text-white shadow-lg shadow-red-600/20"><ShieldCheck className="h-5 w-5" /></div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">Private area</p>
              <h1 className="text-xl font-black tracking-tight">Madrastak administration</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={loadAdminData} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-600 transition hover:border-red-200 hover:text-red-600" title="Refresh data">
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button type="button" onClick={logout} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-100 px-3 text-sm font-bold text-slate-600 transition hover:bg-slate-200" title="Log out">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

        <section aria-labelledby="overview-heading">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Overview</p>
              <h2 id="overview-heading" className="mt-1 text-2xl font-black tracking-tight">Platform accounts</h2>
            </div>
            {loading && <span className="text-sm text-slate-400">Loading...</span>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <OverviewCard label="Total users" value={overview.total_users} />
            <OverviewCard label="Students" value={overview.total_students} />
            <OverviewCard label="Teachers" value={overview.total_teachers} />
            <OverviewCard label="Pending teachers" value={overview.pending_teachers} emphasis />
            <OverviewCard label="Admins" value={overview.total_admins} />
          </div>
        </section>

        <section aria-labelledby="pending-heading" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-6 py-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-600">Needs review</p>
              <h2 id="pending-heading" className="mt-1 text-xl font-black tracking-tight">Pending teacher approvals</h2>
            </div>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">{pendingTeachers.length} pending</span>
          </div>
          <div className="divide-y divide-slate-100">
            {pendingTeachers.length === 0 ? (
              <p className="px-6 py-8 text-sm text-slate-400">There are no pending teacher accounts.</p>
            ) : pendingTeachers.map((teacher) => (
              <div key={teacher.id} className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-bold text-slate-900">{teacher.full_name}</p>
                  <p className="mt-1 text-sm text-slate-500">{teacher.email}</p>
                  <p className="mt-2 text-xs text-slate-400">Registered {formatDate(teacher.created_at)}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={actionId === teacher.id} onClick={() => reviewTeacher(teacher.id, 'approve')} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-50">
                    <Check className="h-4 w-4" /> Approve
                  </button>
                  <button type="button" disabled={actionId === teacher.id} onClick={() => reviewTeacher(teacher.id, 'reject')} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-red-200 px-4 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-50">
                    <X className="h-4 w-4" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="users-heading" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-5">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Directory</p>
            <h2 id="users-heading" className="mt-1 text-xl font-black tracking-tight">User accounts</h2>
          </div>
          <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 lg:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">Search users</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or email" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none transition focus:border-red-400 focus:bg-white focus:ring-4 focus:ring-red-50" />
            </label>
            <label className="relative">
              <span className="sr-only">Filter by role</span>
              <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-8 text-sm outline-none focus:border-red-400 focus:ring-4 focus:ring-red-50">
                <option value="all">All roles</option><option value="student">Students</option><option value="teacher">Teachers</option><option value="admin">Admins</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Filter by account status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-red-400 focus:ring-4 focus:ring-red-50">
                <option value="all">All statuses</option><option value="active">Active</option><option value="pending">Pending</option><option value="rejected">Rejected</option><option value="suspended">Suspended</option>
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-170 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400"><tr><th className="px-6 py-3 font-bold">Name</th><th className="px-6 py-3 font-bold">Email</th><th className="px-6 py-3 font-bold">Role</th><th className="px-6 py-3 font-bold">Status</th><th className="px-6 py-3 font-bold">Created</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((account) => <tr key={account.id} className="hover:bg-slate-50"><td className="px-6 py-4 font-bold text-slate-800">{account.full_name}</td><td className="px-6 py-4 text-slate-500">{account.email}</td><td className="px-6 py-4 capitalize text-slate-600">{account.role}</td><td className="px-6 py-4"><StatusBadge status={account.account_status} /></td><td className="px-6 py-4 text-slate-400">{formatDate(account.created_at)}</td></tr>)}
              </tbody>
            </table>
            {filteredUsers.length === 0 && <p className="px-6 py-8 text-sm text-slate-400">No accounts match these filters.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}

function OverviewCard({ label, value, emphasis = false }) {
  return <div className={`rounded-2xl border p-5 ${emphasis ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}><p className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p><p className={`mt-3 text-3xl font-black ${emphasis ? 'text-amber-700' : 'text-slate-900'}`}>{value}</p></div>;
}

function StatusBadge({ status }) {
  const styles = { active: 'bg-emerald-50 text-emerald-700', pending: 'bg-amber-50 text-amber-700', rejected: 'bg-red-50 text-red-700', suspended: 'bg-slate-100 text-slate-600' };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${styles[status] || styles.suspended}`}>{status || 'unknown'}</span>;
}

function ForbiddenState() {
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6"><div className="max-w-md text-center"><Users className="mx-auto h-12 w-12 text-red-600" /><h1 className="mt-5 text-3xl font-black tracking-tight">Administrator access required</h1><p className="mt-3 text-sm leading-6 text-slate-500">Your account is authenticated, but it is not authorized to view this private area.</p></div></main>;
}

function formatDate(value) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}
