import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { GraduationCap, ArrowLeft, Clock, User, Video, Users, CheckCircle, AlertCircle, X } from 'lucide-react';
import { API_URL } from '../config';

export default function CourseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const [classDetails, setClassDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 4000);
  };

  useEffect(() => {
    fetch(`${API_URL}/api/classes`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          const found = data.find(c => c.id.toString() === id);
          setClassDetails(found);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [id]);

  const handleBook = async () => {
    if (!user) {
      navigate('/login');
      return;
    }
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_URL}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ class_id: classDetails.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showToast('Successfully booked seat in this class!');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-white flex items-center justify-center text-slate-500 font-medium">Loading course details...</div>;
  }

  if (!classDetails) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center space-y-4">
        <p className="text-slate-700 font-bold text-xl">Class not found.</p>
        <button onClick={() => navigate('/')} className="bg-red-600 text-white px-5 py-2.5 rounded-xl font-semibold text-sm">
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 relative">
      {/* Toast Notification */}
      {toast.show && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-2xl shadow-xl text-white text-sm font-medium transition animate-bounce ${
          toast.type === 'error' ? 'bg-red-600' : 'bg-slate-900'
        }`}>
          {toast.type === 'error' ? <AlertCircle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5 text-emerald-400" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Navbar */}
      <header className="border-b border-slate-100 sticky top-0 bg-white/80 backdrop-blur-md z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
            <div className="bg-red-600 text-white p-2.5 rounded-xl shadow-md shadow-red-600/20 flex items-center justify-center">
              <GraduationCap className="w-6 h-6" />
            </div>
            <span className="text-2xl font-extrabold tracking-tight text-slate-900">Madrastak</span>
          </div>
          <button onClick={() => navigate('/')} className="text-sm font-semibold text-slate-600 hover:text-red-600 flex items-center gap-2 transition">
            <ArrowLeft className="w-4 h-4" /> Back to Catalog
          </button>
        </div>
      </header>

      {/* Course Detail Container */}
      <main className="max-w-5xl mx-auto px-6 py-12 space-y-10">
        {/* Banner Hero */}
        <div className="bg-slate-900 text-white rounded-3xl p-8 md:p-12 relative overflow-hidden flex flex-col justify-between space-y-6 shadow-xl">
          <div className="absolute inset-0 bg-gradient-to-tr from-slate-900 to-red-950 opacity-90"></div>
          <div className="relative z-10 space-y-4">
            <span className="bg-red-600 text-white text-xs font-bold px-3.5 py-1.5 rounded-full uppercase tracking-wider">
              Live Interactive Class
            </span>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight">{classDetails.title}</h1>
            <p className="text-slate-300 text-base max-w-2xl leading-relaxed">{classDetails.description}</p>
          </div>

          <div className="relative z-10 flex flex-wrap items-center gap-6 pt-4 border-t border-slate-800 text-sm font-medium text-slate-300">
            <span className="flex items-center gap-2"><Clock className="w-4 h-4 text-red-500" /> {new Date(classDetails.start_time).toLocaleString()}</span>
            <span className="flex items-center gap-2"><Video className="w-4 h-4 text-red-500" /> {classDetails.duration_minutes} mins duration</span>
          </div>
        </div>

        {/* Content Layout */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Main Info */}
          <div className="md:col-span-2 space-y-8">
            <div className="bg-white border border-slate-200/80 p-8 rounded-3xl shadow-sm space-y-4">
              <h3 className="text-xl font-black text-slate-900">About This Live Session</h3>
              <p className="text-slate-600 leading-relaxed text-sm">
                Join instructor {classDetails.teacher_name} for a fully immersive live session. Ask questions in real-time, collaborate with fellow students, and master the core modules of this topic.
              </p>
            </div>
          </div>

          {/* Instructor Sidebar Card & Booking */}
          <div className="space-y-6">
            <div className="bg-white border border-slate-200/80 p-6 rounded-3xl shadow-sm space-y-6">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Instructor</h3>
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 font-bold text-xl flex items-center justify-center border-2 border-slate-100">
                  {classDetails.teacher_name?.[0]}
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 text-base">{classDetails.teacher_name}</h4>
                  <p className="text-xs text-red-600 font-semibold">Expert Lecturer</p>
                </div>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                {classDetails.teacher_bio || 'Dedicated educator specializing in interactive training and practical software development.'}
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 p-6 rounded-3xl shadow-sm space-y-4 text-center">
              <button 
                onClick={handleBook}
                className="w-full bg-red-600 hover:bg-red-700 text-white py-3.5 rounded-2xl font-bold text-sm shadow-lg shadow-red-600/25 transition"
              >
                Book Your Seat Now
              </button>
              <p className="text-xs text-slate-400">Instant access to live classroom upon booking.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}