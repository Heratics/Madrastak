import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, BookOpen, Video, User, Settings, 
  LogOut, Clock, CheckCircle, GraduationCap, X, AlertCircle, Calendar,
  Users, XCircle
} from 'lucide-react';
import { API_URL } from '../config';

export default function StudentDashboard() {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [courseSubTab, setCourseSubTab] = useState('upcoming');
  const [bookings, setBookings] = useState([]);

  // Profile & Settings State
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  
  // Toast Popup State
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const token = localStorage.getItem('token');

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 4000);
  };

  const fetchStudentBookings = async () => {
    try {
      const res = await fetch(`${API_URL}/api/student/bookings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (Array.isArray(data)) setBookings(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchStudentBookings();
  }, []);

  // Cancel Booking
  const handleCancelBooking = async (classId) => {
    if (!window.confirm('Are you sure you want to cancel your seat reservation for this lecture?')) return;

    try {
      const res = await fetch(`${API_URL}/api/bookings/${classId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to cancel reservation');

      showToast('Reservation cancelled successfully. Seat freed up.');
      setBookings(prev => prev.filter(b => b.id !== classId));
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/user/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ full_name: fullName })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showToast('Profile updated successfully!');
      if (user) {
        user.full_name = fullName;
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/user/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showToast('Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const renderStatusBadge = (status) => {
    if (status === 'live') {
      return (
        <span className="bg-red-50 text-red-600 border border-red-200 text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm shadow-red-100">
          <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse"></span> Live Now
        </span>
      );
    }
    if (status === 'ended') {
      return (
        <span className="bg-slate-100 text-slate-600 border border-slate-200 text-xs font-bold px-3 py-1 rounded-full">
          Concluded
        </span>
      );
    }
    return (
      <span className="bg-blue-50 text-blue-600 border border-blue-200 text-xs font-bold px-3 py-1 rounded-full">
        Scheduled
      </span>
    );
  };

  // Split into active/upcoming and previous (concluded)
  const upcomingClasses = bookings.filter(cls => cls.status !== 'ended');
  const previousClasses = bookings.filter(cls => cls.status === 'ended');

  return (
    <div className="min-h-screen bg-slate-50 flex relative">
      {/* Toast Popup */}
      {toast.show && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-2xl shadow-xl text-white text-sm font-medium transition animate-bounce ${
          toast.type === 'error' ? 'bg-red-600' : 'bg-slate-900'
        }`}>
          {toast.type === 'error' ? <AlertCircle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5 text-emerald-400" />}
          <span>{toast.message}</span>
          <button onClick={() => setToast({ show: false, message: '', type: 'success' })} className="ml-2 text-white/70 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col justify-between hidden md:flex sticky top-0 h-screen">
        <div>
          <div className="p-6 flex items-center gap-3 border-b border-slate-100 cursor-pointer" onClick={() => navigate('/')}>
            <div className="bg-red-600 text-white p-2 rounded-xl font-bold flex items-center justify-center">
              <GraduationCap className="w-5 h-5" />
            </div>
            <span className="text-xl font-black text-slate-900">Madrastak</span>
          </div>

          <nav className="p-4 space-y-1.5 text-sm font-medium text-slate-600">
            <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeTab === 'dashboard' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}>
              <LayoutDashboard className="w-5 h-5" /> Dashboard
            </button>
            <button onClick={() => setActiveTab('courses')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeTab === 'courses' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}>
              <BookOpen className="w-5 h-5" /> My Courses
            </button>
            <button onClick={() => setActiveTab('profile')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeTab === 'profile' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}>
              <User className="w-5 h-5" /> Profile
            </button>
            <button onClick={() => setActiveTab('settings')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeTab === 'settings' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}>
              <Settings className="w-5 h-5" /> Settings
            </button>
          </nav>
        </div>

        <div className="p-4 border-t border-slate-100">
          <button onClick={logout} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 hover:bg-red-50 hover:text-red-600 font-medium transition">
            <LogOut className="w-5 h-5" /> Logout
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-8 md:p-12 space-y-8 overflow-y-auto">
        <div className="flex justify-between items-center bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm">
          <div>
            <h1 className="text-2xl font-black text-slate-900 capitalize">{activeTab === 'courses' ? 'My Courses' : activeTab}</h1>
            <p className="text-slate-500 text-sm mt-0.5">Welcome back, {user?.full_name}</p>
          </div>
          <button onClick={() => navigate('/')} className="text-xs bg-slate-100 hover:bg-slate-200 px-4 py-2.5 rounded-xl font-semibold transition text-slate-700">
            View Public Site
          </button>
        </div>

        {/* TAB 1: DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-2">
                <div className="text-red-600"><BookOpen className="w-6 h-6" /></div>
                <h3 className="text-3xl font-black text-slate-900">{bookings.length}</h3>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Enrolled Courses</p>
              </div>
              <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-2">
                <div className="text-blue-600"><Calendar className="w-6 h-6" /></div>
                <h3 className="text-3xl font-black text-slate-900">{upcomingClasses.length}</h3>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Upcoming & Active Sessions</p>
              </div>
            </div>

            <div className="space-y-6">
              <h2 className="text-xl font-black text-slate-900">Your Scheduled Virtual Sessions</h2>
              {upcomingClasses.length === 0 ? (
                <div className="bg-white border border-slate-200 p-8 rounded-2xl text-center text-slate-500">
                  You haven't booked any upcoming classes yet. Explore the catalog to reserve a seat!
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {upcomingClasses.map(cls => (
                    <div key={cls.id} className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm flex flex-col justify-between space-y-4">
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          {renderStatusBadge(cls.status)}
                          <span className="bg-red-50 text-red-600 text-xs font-bold px-3 py-1 rounded-full">
                            Seat Confirmed
                          </span>
                        </div>
                        <h3 className="text-xl font-bold text-slate-900">{cls.title}</h3>
                        <p className="text-slate-500 text-sm line-clamp-2">{cls.description}</p>
                        <div className="flex items-center gap-4 text-xs text-slate-400">
                          <span>Instructor: <strong className="text-slate-700">{cls.teacher_name}</strong></span>
                          <span>•</span>
                          <span>{cls.duration_minutes} mins</span>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-slate-100 flex flex-wrap justify-between items-center gap-2">
                        <span className="text-xs text-slate-500 font-medium">
                          {new Date(cls.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>

                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => navigate(`/classroom/${cls.id}`)}
                            className={`${
                              cls.status === 'live'
                                ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-600/25 animate-pulse'
                                : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20'
                            } px-4 py-2 rounded-xl text-xs font-semibold shadow-md transition flex items-center gap-1.5 cursor-pointer`}
                          >
                            <Video className="w-4 h-4" /> 
                            {cls.status === 'live' ? 'Join Live Now' : 'Enter Classroom'}
                          </button>

                          <button
                            onClick={() => handleCancelBooking(cls.id)}
                            className="bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-600 px-3 py-2 rounded-xl text-xs font-semibold transition"
                            title="Cancel your reservation"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: MY COURSES */}
        {activeTab === 'courses' && (
          <div className="space-y-6">
            <div className="flex gap-4 border-b border-slate-200 pb-4">
              <button 
                onClick={() => setCourseSubTab('upcoming')}
                className={`px-5 py-2 rounded-xl text-sm font-bold transition ${courseSubTab === 'upcoming' ? 'bg-red-600 text-white shadow-md shadow-red-600/20' : 'bg-white text-slate-600 border border-slate-200'}`}
              >
                Upcoming Sessions ({upcomingClasses.length})
              </button>
              <button 
                onClick={() => setCourseSubTab('previous')}
                className={`px-5 py-2 rounded-xl text-sm font-bold transition ${courseSubTab === 'previous' ? 'bg-red-600 text-white shadow-md shadow-red-600/20' : 'bg-white text-slate-600 border border-slate-200'}`}
              >
                Completed Sessions ({previousClasses.length})
              </button>
            </div>

            {courseSubTab === 'upcoming' ? (
              upcomingClasses.length === 0 ? (
                <div className="bg-white border border-slate-200 p-8 rounded-2xl text-center text-slate-500">No upcoming enrolled classes found.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {upcomingClasses.map(cls => (
                    <div key={cls.id} className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-4 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          {renderStatusBadge(cls.status)}
                          <span className="text-xs font-semibold text-slate-400">
                            Instructor: {cls.teacher_name}
                          </span>
                        </div>
                        <h3 className="text-xl font-bold text-slate-900">{cls.title}</h3>
                        <p className="text-slate-500 text-sm">{cls.description}</p>
                      </div>

                      <div className="pt-4 border-t border-slate-100 flex flex-wrap justify-between items-center gap-2">
                        <span className="text-xs text-slate-500">{new Date(cls.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => navigate(`/classroom/${cls.id}`)}
                            className={`${
                              cls.status === 'live' 
                                ? 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-600/25 animate-pulse' 
                                : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20'
                            } px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer`}
                          >
                            {cls.status === 'live' ? 'Join Live Now' : 'Enter Classroom'}
                          </button>
                          <button 
                            onClick={() => handleCancelBooking(cls.id)}
                            className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-2 rounded-xl text-xs font-semibold transition"
                          >
                            Cancel Reservation
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              previousClasses.length === 0 ? (
                <div className="bg-white border border-slate-200 p-8 rounded-2xl text-center text-slate-500">No previous classes completed yet.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {previousClasses.map(cls => (
                    <div key={cls.id} className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-4 opacity-80">
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          <span className="bg-slate-100 text-slate-500 text-xs font-bold px-2.5 py-1 rounded-full">
                            Concluded
                          </span>
                          <span className="text-xs font-semibold text-slate-400">Instructor: {cls.teacher_name}</span>
                        </div>
                        <h3 className="text-xl font-bold text-slate-900">{cls.title}</h3>
                        <p className="text-slate-500 text-sm">{cls.description}</p>
                      </div>
                      <div className="pt-4 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500">
                        <span>Scheduled on: {new Date(cls.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        <span className="bg-slate-100 text-slate-600 px-3 py-1 rounded-lg font-medium">Archived</span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}

        {/* TAB 3: PROFILE */}
        {activeTab === 'profile' && (
          <div className="max-w-xl bg-white border border-slate-200/80 p-8 rounded-2xl shadow-sm space-y-6">
            <h3 className="text-lg font-bold text-slate-900">Student Profile</h3>
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-2">Full Name</label>
                <input 
                  type="text" 
                  value={fullName} 
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition"
                />
              </div>
              <div>
                <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-2">Email Address</label>
                <input 
                  type="email" 
                  disabled 
                  value={user?.email || ''} 
                  className="w-full bg-slate-100 border border-slate-200 rounded-xl p-3 text-slate-500 text-sm cursor-not-allowed"
                />
              </div>
              <button type="submit" className="bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-3 rounded-xl text-sm shadow-md transition cursor-pointer">
                Save Changes
              </button>
            </form>
          </div>
        )}

        {/* TAB 4: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="max-w-xl bg-white border border-slate-200/80 p-8 rounded-2xl shadow-sm space-y-6">
            <h3 className="text-lg font-bold text-slate-900">Change Password</h3>
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div>
                <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-2">Current Password</label>
                <input 
                  type="password" 
                  value={currentPassword} 
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition"
                />
              </div>

              <div>
                <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-2">New Password</label>
                <input 
                  type="password" 
                  value={newPassword} 
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition"
                />
              </div>

              <button type="submit" className="bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-3 rounded-xl text-sm shadow-md transition cursor-pointer">
                Update Password
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}