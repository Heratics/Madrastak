import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, BookOpen, Video, FileText, Award, Heart, 
  Bell, User, Settings, LogOut, Clock, CheckCircle, TrendingUp 
} from 'lucide-react';
import { API_URL } from '../config';

export default function StudentDashboard() {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [bookings, setBookings] = useState([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch(`${API_URL}/api/student/bookings`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setBookings(data); })
      .catch(err => console.error(err));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col justify-between hidden md:flex sticky top-0 h-screen">
        <div>
          <div className="p-6 flex items-center gap-3 border-b border-slate-100 cursor-pointer" onClick={() => navigate('/')}>
            <div className="bg-red-600 text-white p-2 rounded-xl font-bold">M</div>
            <span className="text-xl font-black text-slate-900">Madrastak</span>
          </div>

          <nav className="p-4 space-y-1.5 text-sm font-medium text-slate-600">
            <button onClick={() => setActiveMenu('dashboard')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeMenu === 'dashboard' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}>
              <LayoutDashboard className="w-5 h-5" /> Dashboard
            </button>
            <button onClick={() => setActiveMenu('courses')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeMenu === 'courses' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}>
              <BookOpen className="w-5 h-5" /> My Courses
            </button>
            <button onClick={() => setActiveMenu('live')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeMenu === 'live' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}>
              <Video className="w-5 h-5" /> Live Classes
            </button>
            <button onClick={() => setActiveMenu('notes')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeMenu === 'notes' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}>
              <FileText className="w-5 h-5" /> Notes
            </button>
            <button onClick={() => setActiveMenu('certificates')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeMenu === 'certificates' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}>
              <Award className="w-5 h-5" /> Certificates
            </button>
            <button onClick={() => setActiveMenu('wishlist')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeMenu === 'wishlist' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}>
              <Heart className="w-5 h-5" /> Wishlist
            </button>
            <button onClick={() => setActiveMenu('notifications')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeMenu === 'notifications' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}>
              <Bell className="w-5 h-5" /> Notifications
            </button>
            <button onClick={() => setActiveMenu('profile')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeMenu === 'profile' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}>
              <User className="w-5 h-5" /> Profile
            </button>
            <button onClick={() => setActiveMenu('settings')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeMenu === 'settings' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}>
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
            <h1 className="text-2xl font-black text-slate-900">Dashboard</h1>
            <p className="text-slate-500 text-sm mt-0.5" dir="rtl">مرحباً بك، {user?.full_name}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 font-bold flex items-center justify-center">
              {user?.full_name?.[0]}
            </div>
          </div>
        </div>

        {/* Status Metrics Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-2">
            <div className="text-red-600"><BookOpen className="w-6 h-6" /></div>
            <h3 className="text-3xl font-black text-slate-900">{bookings.length}</h3>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Courses Enrolled</p>
          </div>
          <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-2">
            <div className="text-green-600"><TrendingUp className="w-6 h-6" /></div>
            <h3 className="text-3xl font-black text-slate-900">12</h3>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Completed Lessons</p>
          </div>
          <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-2">
            <div className="text-blue-600"><Clock className="w-6 h-6" /></div>
            <h3 className="text-3xl font-black text-slate-900">24</h3>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Hours Watched</p>
          </div>
          <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-2">
            <div className="text-amber-600"><Award className="w-6 h-6" /></div>
            <h3 className="text-3xl font-black text-slate-900">2</h3>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Certificates</p>
          </div>
        </div>

        {/* Live Classes & Classrooms */}
        <div className="space-y-6">
          <h2 className="text-xl font-black text-slate-900">Upcoming Live Classes & Jitsi Rooms</h2>
          {bookings.length === 0 ? (
            <div className="bg-white border border-slate-200 p-8 rounded-2xl text-center text-slate-500">
              You haven't booked any live classes yet. Explore the catalog to reserve a seat!
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {bookings.map(cls => (
                <div key={cls.id} className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <span className="bg-red-50 text-red-600 text-xs font-bold px-3 py-1 rounded-full">Active Session</span>
                    <h3 className="text-xl font-bold text-slate-900">{cls.title}</h3>
                    <p className="text-slate-500 text-sm">{cls.description}</p>
                    <p className="text-xs font-medium text-slate-400">Teacher: {cls.teacher_name}</p>
                  </div>
                  <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
                    <span className="text-xs text-slate-500">{new Date(cls.start_time).toLocaleString()}</span>
                    <a 
                      href={`https://meet.jit.si/${cls.meeting_room_id}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-emerald-600/20 transition flex items-center gap-2"
                    >
                      <Video className="w-4 h-4" /> Join Classroom
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}