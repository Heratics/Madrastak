import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { 
  GraduationCap, ArrowLeft, Clock, User, Video, Users, 
  CheckCircle, AlertCircle, X, Check, XCircle 
} from 'lucide-react';
import { API_URL } from '../config';

export default function CourseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const [classDetails, setClassDetails] = useState(null);
  const [isBooked, setIsBooked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const token = localStorage.getItem('token');

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 4000);
  };

  const fetchDetails = async () => {
    try {
      const res = await fetch(`${API_URL}/api/classes`);
      const data = await res.json();
      if (Array.isArray(data)) {
        const found = data.find(c => c.id.toString() === id);
        setClassDetails(found);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const checkUserEnrollment = async () => {
    if (!token || !user || user.role !== 'student') return;
    try {
      const res = await fetch(`${API_URL}/api/student/bookings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        const booked = data.some(b => b.id.toString() === id);
        setIsBooked(booked);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchDetails();
    checkUserEnrollment();
  }, [id, token]);

  const handleBook = async () => {
    if (!user) {
      navigate('/login');
      return;
    }

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
      setIsBooked(true);
      setClassDetails(prev => prev ? { ...prev, enrolled_count: (prev.enrolled_count || 0) + 1 } : prev);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleCancelBooking = async () => {
    if (!window.confirm('Are you sure you want to cancel your seat for this lecture?')) return;

    try {
      const res = await fetch(`${API_URL}/api/bookings/${classDetails.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      showToast('Booking cancelled successfully.');
      setIsBooked(false);
      setClassDetails(prev => prev ? { ...prev, enrolled_count: Math.max(0, (prev.enrolled_count || 1) - 1) } : prev);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleHostStart = async () => {
    try {
      if (classDetails?.status === 'scheduled') {
        const currentToken = localStorage.getItem('token') || token;
        await fetch(`${API_URL}/api/classes/${classDetails.id}/start`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${currentToken}` }
        });
      }
    } catch (e) {
      console.error('Error starting class:', e);
    }
    navigate(`/classroom/${classDetails.id}`);
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

  const isFull = classDetails.student_limit !== null && (classDetails.enrolled_count >= classDetails.student_limit);
  const isEnded = classDetails.status === 'ended';
  const isLive = classDetails.status === 'live';
  const isTeacherOwner = user && user.id === classDetails.teacher_id;

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
            <div className="flex items-center gap-2.5 flex-wrap">
              {isLive ? (
                <span className="bg-red-600 text-white text-xs font-bold px-3.5 py-1.5 rounded-full uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                  Live Now
                </span>
              ) : isEnded ? (
                <span className="bg-slate-800 text-slate-300 text-xs font-bold px-3.5 py-1.5 rounded-full uppercase tracking-wider">
                  Session Concluded
                </span>
              ) : (
                <span className="bg-red-600 text-white text-xs font-bold px-3.5 py-1.5 rounded-full uppercase tracking-wider">
                  Upcoming Scheduled Lecture
                </span>
              )}

              <span className="bg-slate-800/80 text-slate-300 text-xs font-medium px-3.5 py-1.5 rounded-full flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-red-400" />
                {classDetails.enrolled_count || 0} {classDetails.student_limit ? `/ ${classDetails.student_limit}` : ''} Enrolled
              </span>
            </div>

            <h1 className="text-3xl md:text-5xl font-black tracking-tight">{classDetails.title}</h1>
            <p className="text-slate-300 text-base max-w-2xl leading-relaxed">{classDetails.description}</p>
          </div>

          <div className="relative z-10 flex flex-wrap items-center gap-6 pt-4 border-t border-slate-800 text-sm font-medium text-slate-300">
            <span className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-red-500" /> 
              {new Date(classDetails.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
            <span className="flex items-center gap-2">
              <Video className="w-4 h-4 text-red-500" /> 
              {classDetails.duration_minutes >= 999999 ? 'Self-Paced / Ongoing' : `${classDetails.duration_minutes} mins duration`}
            </span>
          </div>
        </div>

        {/* Content Layout */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Main Info */}
          <div className="md:col-span-2 space-y-8">
            <div className="bg-white border border-slate-200/80 p-8 rounded-3xl shadow-sm space-y-4">
              <h3 className="text-xl font-black text-slate-900">About This Live Session</h3>
              <p className="text-slate-600 leading-relaxed text-sm">
                Join instructor {classDetails.teacher_name} for a fully immersive live session inside Madrastak. Ask questions in real-time, participate in discussions, and master the core concepts.
              </p>
            </div>

            {/* Capacity Status Card */}
            <div className="bg-slate-50 border border-slate-200/80 p-6 rounded-3xl space-y-3">
              <h4 className="text-sm font-bold text-slate-800">Enrollment & Availability</h4>
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Current Registrations:</span>
                <span className="font-bold text-slate-900">{classDetails.enrolled_count || 0} students</span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Maximum Capacity:</span>
                <span className="font-bold text-slate-900">
                  {classDetails.student_limit ? `${classDetails.student_limit} students` : 'Unlimited seats'}
                </span>
              </div>
              {isFull && (
                <p className="text-xs font-semibold text-red-600 pt-1">
                  ⚠️ This lecture has reached its maximum student capacity.
                </p>
              )}
            </div>
          </div>

          {/* Instructor Sidebar Card & Booking */}
          <div className="space-y-6">
            <div className="bg-white border border-slate-200/80 p-6 rounded-3xl shadow-sm space-y-6">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Instructor</h3>
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 font-bold text-xl flex items-center justify-center overflow-hidden border-2 border-slate-100">
                  {classDetails.teacher_profile_pic ? (
                    <img src={classDetails.teacher_profile_pic} alt="Instructor" className="w-full h-full object-cover" />
                  ) : (
                    classDetails.teacher_name?.[0]
                  )}
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

            {/* Action Box */}
            <div className="bg-slate-50 border border-slate-200/80 p-6 rounded-3xl shadow-sm space-y-4 text-center">
              {isTeacherOwner ? (
                <div className="space-y-3">
                  <div className="p-3 bg-red-50 text-red-600 rounded-xl text-xs font-semibold">
                    You are the instructor of this class.
                  </div>
                  {isEnded ? (
                    <div className="space-y-2">
                      <button 
                        disabled 
                        className="w-full bg-slate-200 text-slate-400 py-3.5 rounded-2xl font-bold text-sm cursor-not-allowed select-none"
                      >
                        Lecture Concluded
                      </button>
                      <button
                        onClick={() => navigate('/dashboard')}
                        className="w-full bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 py-2.5 rounded-xl font-semibold text-xs transition cursor-pointer"
                      >
                        View in Teacher Dashboard
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={handleHostStart}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3.5 rounded-2xl font-bold text-sm shadow-md transition cursor-pointer"
                    >
                      {classDetails.status === 'live' ? 'Enter Live Classroom' : 'Start Virtual Session as Host'}
                    </button>
                  )}
                </div>
              ) : isBooked ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-center gap-2 p-3 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-2xl text-xs font-bold">
                    <Check className="w-4 h-4" /> You are enrolled in this lecture
                  </div>
                  {isEnded ? (
                    <div className="space-y-2">
                      <button 
                        disabled
                        className="w-full bg-slate-200 text-slate-400 py-3.5 rounded-2xl font-bold text-sm cursor-not-allowed select-none"
                      >
                        Lecture Concluded
                      </button>
                      <p className="text-xs text-slate-400">This class session has concluded.</p>
                    </div>
                  ) : (
                    <>
                      <button 
                        onClick={() => navigate(`/classroom/${classDetails.id}`)}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3.5 rounded-2xl font-bold text-sm shadow-md shadow-emerald-600/20 transition flex items-center justify-center gap-2"
                      >
                        <Video className="w-4 h-4" /> Enter Classroom
                      </button>
                      <button 
                        onClick={handleCancelBooking}
                        className="w-full bg-white hover:bg-red-50 border border-slate-200 text-red-600 py-2.5 rounded-xl font-semibold text-xs transition"
                      >
                        Cancel Reservation
                      </button>
                    </>
                  )}
                </div>
              ) : isEnded ? (
                <div className="space-y-2">
                  <button 
                    disabled 
                    className="w-full bg-slate-200 text-slate-400 py-3.5 rounded-2xl font-bold text-sm cursor-not-allowed"
                  >
                    Lecture Concluded
                  </button>
                  <p className="text-xs text-slate-400">This class has already ended.</p>
                </div>
              ) : isFull ? (
                <div className="space-y-2">
                  <button 
                    disabled 
                    className="w-full bg-slate-300 text-slate-500 py-3.5 rounded-2xl font-bold text-sm cursor-not-allowed"
                  >
                    Class Full
                  </button>
                  <p className="text-xs text-slate-400">All available seats have been booked.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <button 
                    onClick={handleBook}
                    className="w-full bg-red-600 hover:bg-red-700 text-white py-3.5 rounded-2xl font-bold text-sm shadow-lg shadow-red-600/25 transition cursor-pointer"
                  >
                    Book Your Seat Now
                  </button>
                  <p className="text-xs text-slate-400">Instant access to live classroom upon booking.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}