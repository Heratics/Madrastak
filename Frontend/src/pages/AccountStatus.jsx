import { ArrowLeft, Clock3, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function AccountStatus({ status = 'pending' }) {
  const navigate = useNavigate();
  const isPending = status === 'pending';
  const title = isPending ? 'Your teacher account is under review' : 'Your account is not active';
  const message = isPending
    ? 'An administrator needs to approve your teacher account before teacher tools become available.'
    : 'Please contact an administrator if you believe this status is incorrect.';

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8 text-slate-900">
      <div className="mx-auto flex min-h-[80vh] max-w-xl flex-col items-center justify-center text-center">
        <div className={`mb-6 flex h-16 w-16 items-center justify-center rounded-2xl ${isPending ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
          {isPending ? <Clock3 className="h-8 w-8" /> : <ShieldAlert className="h-8 w-8" />}
        </div>
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-red-600">Madrastak account status</p>
        <h1 className="text-3xl font-black tracking-tight">{title}</h1>
        <p className="mt-4 max-w-md text-sm leading-7 text-slate-500">{message}</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-bold text-white transition hover:bg-red-600 focus:outline-none focus:ring-4 focus:ring-red-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Manastak
        </button>
      </div>
    </main>
  );
}
