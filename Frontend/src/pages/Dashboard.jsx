import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, BookOpen, PlusCircle, User, Settings, 
  LogOut, Video, Users, Clock, Trash2, CheckCircle, GraduationCap, 
  X, AlertCircle, Camera, UserCheck, Calendar, ShieldAlert, Archive 
} from 'lucide-react';
import { API_URL } from '../config';

export default function TeacherDashboard() {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [classesSubTab, setClassesSubTab] = useState('upcoming');
  const [classes, setClasses] = useState([]);
  
  // Custom Toast Popup State
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  // Attendance Modal State
  const [attendanceModal, setAttendanceModal] = useState({ 
    open: false, 
    loading: false, 
    data: null, 
    error: null 
  });

  // Create Class Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('');
  const [isNoLimitDuration, setIsNoLimitDuration] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [studentLimit, setStudentLimit] = useState('25');

  // Profile & Settings State
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [bio, setBio] = useState('');
  const [profilePicPreview, setProfilePicPreview] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const token = localStorage.getItem('token');

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: 'success' });
    }, 4000);
  };

  const fetchTeacherClasses = async () => {
    try {
      const currentToken = localStorage.getItem('token') || token;
      if (!currentToken) return;
      const res = await fetch(`${API_URL}/api/teacher/classes`, {
        headers: { 'Authorization': `Bearer ${currentToken}` }
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setClasses(data);
      } else {
        console.error('Failed to fetch teacher classes:', data);
      }
    } catch (err) {
      console.error('Error fetching teacher classes:', err);
    }
  };

  const upcomingClasses = classes.filter(c => c.status !== 'ended');
  const concludedClasses = classes.filter(c => c.status === 'ended');

  useEffect(() => {
    fetchTeacherClasses();

    fetch(`${API_URL}/api/user/profile`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data) {
          if (data.full_name) setFullName(data.full_name);
          if (data.bio) setBio(data.bio);
          if (data.profile_pic) setProfilePicPreview(data.profile_pic);
        }
      })
      .catch(err => console.error(err));
  }, []);

  // Fetch Attendance Roster for Modal
  const handleOpenAttendance = async (classId) => {
    setAttendanceModal({ open: true, loading: true, data: null, error: null });
    try {
      const res = await fetch(`${API_URL}/api/teacher/classes/${classId}/attendance`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to retrieve attendance roster');
      setAttendanceModal({ open: true, loading: false, data, error: null });
    } catch (err) {
      setAttendanceModal({ open: true, loading: false, data: null, error: err.message });
    }
  };

  // Cloudinary Widget Integration
  const openCloudinaryWidget = () => {
    if (!window.cloudinary) {
      showToast('Cloudinary widget not loaded. Please refresh.', 'error');
      return;
    }
    window.cloudinary.createUploadWidget(
      {
        cloudName: 'vspcdig8',
        uploadPreset: 'madrastak',
        sources: ['local', 'url', 'camera'],
        multiple: false,
        cropping: true,
        croppingAspectRatio: 1,
      },
      (error, result) => {
        if (!error && result && result.event === 'success') {
          const imageUrl = result.info.secure_url;
          setProfilePicPreview(imageUrl);
          showToast('Image uploaded successfully! Click Save Profile to apply.');
        }
      }
    ).open();
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/teacher/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ full_name: fullName, bio, profile_pic: profilePicPreview })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      
      showToast('Profile updated successfully!');
      if (user) {
        user.full_name = fullName;
        user.bio = bio;
        user.profile_pic = profilePicPreview;
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

  const handleCreateClass = async (e) => {
    e.preventDefault();

    // Frontend validation before submission
    if (!title.trim() || title.trim().length < 3) {
      showToast('Class title must be at least 3 characters long.', 'error');
      return;
    }

    if (!description.trim() || description.trim().length < 5) {
      showToast('Please provide a brief description of the class.', 'error');
      return;
    }

    if (!startTime) {
      showToast('Please select a scheduled start date and time.', 'error');
      return;
    }

    const startTimestamp = new Date(startTime).getTime();
    if (startTimestamp < Date.now() - (5 * 60 * 1000)) {
      showToast('Class start time cannot be in the past.', 'error');
      return;
    }

    const finalDuration = isNoLimitDuration ? 999999 : parseInt(durationMinutes);
    if (!isNoLimitDuration && (!finalDuration || finalDuration <= 0)) {
      showToast('Duration must be a positive number of minutes.', 'error');
      return;
    }

    try {
      const currentToken = localStorage.getItem('token') || token;
      const res = await fetch(`${API_URL}/api/classes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          start_time: new Date(startTime).toISOString(),
          duration_minutes: finalDuration,
          student_limit: studentLimit
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to schedule class');

      showToast('Class scheduled successfully!');
      setTitle('');
      setDescription('');
      setStartTime('');
      await fetchTeacherClasses();
      setClassesSubTab('upcoming');
      setActiveTab('classes');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleStartClass = async (classId, currentStatus) => {
    try {
      if (currentStatus === 'scheduled') {
        const currentToken = localStorage.getItem('token') || token;
        await fetch(`${API_URL}/api/classes/${classId}/start`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${currentToken}` }
        });
      }
    } catch (e) {
      console.error('Error starting class:', e);
    }
    navigate(`/classroom/${classId}`);
  };

  const handleDeleteClass = async (classId) => {
    if (!window.confirm('Are you sure you want to delete this class?')) return;
    try {
      const currentToken = localStorage.getItem('token') || token;
      const res = await fetch(`${API_URL}/api/classes/${classId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${currentToken}` }
      });
      if (!res.ok) throw new Error('Failed to delete class');
      showToast('Class deleted successfully.');
      await fetchTeacherClasses();
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

  // Min date for datetime-local input (current minute)
  const minDateTime = new Date(Date.now() - (60 * 1000)).toISOString().slice(0, 16);

  return (
    <div className="min-h-screen bg-slate-50 flex relative">
      {/* Custom In-App Toast Popup */}
      {toast.show && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-2xl shadow-xl text-white text-sm font-medium transition animate-bounce ${
          toast.type === 'error' ? 'bg-red-600' : 'bg-slate-900'
        }`}>
          {toast.type === 'error' ? <AlertCircle className="w-5 h-5 text-white" /> : <CheckCircle className="w-5 h-5 text-emerald-400" />}
          <span>{toast.message}</span>
          <button onClick={() => setToast({ show: false, message: '', type: 'success' })} className="ml-2 text-white/70 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Attendance Roster Modal */}
      {attendanceModal.open && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  {attendanceModal.data?.title || 'Attendance & Session Roster'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Verified student participation tracking for this lecture.
                </p>
              </div>
              <button 
                onClick={() => setAttendanceModal({ open: false, loading: false, data: null, error: null })}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {attendanceModal.loading ? (
                <div className="py-12 text-center text-slate-500 font-medium text-sm">
                  Loading attendance records...
                </div>
              ) : attendanceModal.error ? (
                <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-medium flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <span>{attendanceModal.error}</span>
                </div>
              ) : attendanceModal.data?.roster?.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-sm">
                  No students have booked or joined this lecture yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Summary Bar */}
                  <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 text-center">
                    <div>
                      <p className="text-2xl font-black text-slate-900">{attendanceModal.data?.totalBooked || 0}</p>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Booked Students</p>
                    </div>
                    <div>
                      <p className="text-2xl font-black text-emerald-600">{attendanceModal.data?.totalAttended || 0}</p>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Actually Attended</p>
                    </div>
                  </div>

                  {/* Student Table */}
                  <div className="border border-slate-100 rounded-2xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                        <tr>
                          <th className="p-3.5">Student</th>
                          <th className="p-3.5">Status</th>
                          <th className="p-3.5">Time in Session</th>
                          <th className="p-3.5">First Joined</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {attendanceModal.data?.roster?.map((student) => (
                          <tr key={student.student_id} className="hover:bg-slate-50/80 transition">
                            <td className="p-3.5 font-medium">
                              <p className="text-slate-900 font-bold">{student.full_name}</p>
                              <p className="text-slate-400 text-[11px]">{student.email}</p>
                              {student.booked_at && (
                                <p className="text-slate-400 text-[10px]">Booked: {new Date(student.booked_at).toLocaleDateString()}</p>
                              )}
                            </td>
                            <td className="p-3.5">
                              {student.attended ? (
                                <span className="bg-emerald-50 text-emerald-600 border border-emerald-200 font-bold px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                                  <UserCheck className="w-3 h-3" /> Attended
                                </span>
                              ) : (
                                <span className="bg-slate-100 text-slate-400 font-medium px-2.5 py-0.5 rounded-full inline-block">
                                  Absent
                                </span>
                              )}
                            </td>
                            <td className="p-3.5 font-semibold text-slate-900">
                              {student.attended ? `${student.total_duration_minutes} mins` : '—'}
                            </td>
                            <td className="p-3.5 text-slate-500">
                              {student.first_joined_at ? new Date(student.first_joined_at).toLocaleTimeString() : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
              <button 
                onClick={() => setAttendanceModal({ open: false, loading: false, data: null, error: null })}
                className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2 rounded-xl text-xs font-semibold transition"
              >
                Close
              </button>
            </div>
          </div>
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
            <button 
              onClick={() => setActiveTab('dashboard')} 
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition cursor-pointer ${activeTab === 'dashboard' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}
            >
              <LayoutDashboard className="w-5 h-5" /> Dashboard
            </button>
            <button 
              onClick={() => { setActiveTab('classes'); setClassesSubTab('upcoming'); }} 
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition cursor-pointer ${activeTab === 'classes' && classesSubTab === 'upcoming' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}
            >
              <div className="flex items-center gap-3">
                <BookOpen className="w-5 h-5" /> Upcoming & Active
              </div>
              {upcomingClasses.length > 0 && (
                <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
                  {upcomingClasses.length}
                </span>
              )}
            </button>
            <button 
              onClick={() => { setActiveTab('concluded'); setClassesSubTab('concluded'); }} 
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition cursor-pointer ${activeTab === 'concluded' || (activeTab === 'classes' && classesSubTab === 'concluded') ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}
            >
              <div className="flex items-center gap-3">
                <Archive className="w-5 h-5" /> Concluded Classes
              </div>
              {concludedClasses.length > 0 && (
                <span className="bg-slate-100 text-slate-600 text-xs font-bold px-2 py-0.5 rounded-full">
                  {concludedClasses.length}
                </span>
              )}
            </button>
            <button 
              onClick={() => setActiveTab('create')} 
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition cursor-pointer ${activeTab === 'create' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}
            >
              <PlusCircle className="w-5 h-5" /> Create Class
            </button>
            <button 
              onClick={() => setActiveTab('profile')} 
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition cursor-pointer ${activeTab === 'profile' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}
            >
              <User className="w-5 h-5" /> Profile
            </button>
            <button 
              onClick={() => setActiveTab('settings')} 
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition cursor-pointer ${activeTab === 'settings' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}
            >
              <Settings className="w-5 h-5" /> Settings
            </button>
          </nav>
        </div>

        <div className="p-4 border-t border-slate-100">
          <button onClick={logout} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 hover:bg-red-50 hover:text-red-600 font-medium transition cursor-pointer">
            <LogOut className="w-5 h-5" /> Logout
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-8 md:p-12 space-y-8 overflow-y-auto">
        <div className="flex justify-between items-center bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm">
          <div>
            <h1 className="text-2xl font-black text-slate-900">
              {activeTab === 'dashboard' && 'Dashboard Overview'}
              {activeTab === 'classes' && (classesSubTab === 'concluded' ? 'Concluded Classes' : 'Upcoming & Active Classes')}
              {activeTab === 'concluded' && 'Concluded Classes'}
              {activeTab === 'create' && 'Schedule & Create Class'}
              {activeTab === 'profile' && 'Instructor Profile'}
              {activeTab === 'settings' && 'Account Settings'}
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">Welcome back, {user?.full_name} (Instructor)</p>
          </div>
          <button onClick={() => navigate('/')} className="text-xs bg-slate-100 hover:bg-slate-200 px-4 py-2.5 rounded-xl font-semibold transition text-slate-700 cursor-pointer">
            View Public Site
          </button>
        </div>

        {/* TAB 1: DASHBOARD OVERVIEW */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
              <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-2">
                <div className="text-red-600"><BookOpen className="w-6 h-6" /></div>
                <h3 className="text-3xl font-black text-slate-900">{classes.length}</h3>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Hosted</p>
              </div>
              <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-2">
                <div className="text-emerald-600"><Users className="w-6 h-6" /></div>
                <h3 className="text-3xl font-black text-slate-900">
                  {classes.reduce((acc, c) => acc + (c.enrolled_students?.length || 0), 0)}
                </h3>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Registered</p>
              </div>
              <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-2">
                <div className="text-blue-600"><Video className="w-6 h-6" /></div>
                <h3 className="text-3xl font-black text-slate-900">{upcomingClasses.length}</h3>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Upcoming & Active</p>
              </div>
              <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-2">
                <div className="text-slate-600"><Archive className="w-6 h-6" /></div>
                <h3 className="text-3xl font-black text-slate-900">{concludedClasses.length}</h3>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Concluded</p>
              </div>
            </div>

            {/* Upcoming & Active Section */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-black text-slate-900">Upcoming & Active Sessions</h2>
                  <p className="text-xs text-slate-400">Classes ready to start or live right now</p>
                </div>
                {upcomingClasses.length > 0 && (
                  <button 
                    onClick={() => { setActiveTab('classes'); setClassesSubTab('upcoming'); }}
                    className="text-xs font-bold text-red-600 hover:text-red-700 transition cursor-pointer"
                  >
                    Manage All ({upcomingClasses.length}) &rarr;
                  </button>
                )}
              </div>

              {upcomingClasses.length === 0 ? (
                <div className="bg-white border border-slate-200 p-8 rounded-2xl text-center text-slate-500 space-y-3">
                  <p>You have no upcoming or live classes scheduled right now.</p>
                  <button 
                    onClick={() => setActiveTab('create')}
                    className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-md shadow-red-600/20 transition cursor-pointer"
                  >
                    Create a Class
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {upcomingClasses.map(cls => (
                    <div key={cls.id} className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-4 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2">
                            {renderStatusBadge(cls.status)}
                            <span className="bg-slate-50 text-slate-600 text-xs font-bold px-3 py-1 rounded-full border border-slate-200">
                              Virtual Classroom
                            </span>
                          </div>
                          <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full flex items-center gap-1 border border-emerald-100">
                            <Users className="w-3.5 h-3.5" /> 
                            {cls.enrolled_students?.length || 0} {cls.student_limit ? `/ ${cls.student_limit}` : ''} Students
                          </span>
                        </div>
                        <h3 className="text-xl font-bold text-slate-900">{cls.title}</h3>
                        <p className="text-slate-500 text-sm line-clamp-2">{cls.description}</p>
                        <p className="text-xs text-slate-400">Scheduled: {new Date(cls.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
                      </div>

                      <div className="pt-4 border-t border-slate-100 flex flex-wrap justify-between items-center gap-2">
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => handleStartClass(cls.id, cls.status)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20 px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                          >
                            <Video className="w-4 h-4" /> 
                            {cls.status === 'live' ? 'Join Live Session' : 'Start Virtual Session'}
                          </button>
                          <button 
                            onClick={() => handleOpenAttendance(cls.id)}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                          >
                            <UserCheck className="w-3.5 h-3.5 text-slate-500" /> Attendance
                          </button>
                        </div>
                        <button onClick={() => handleDeleteClass(cls.id)} className="text-slate-400 hover:text-red-600 p-2 transition cursor-pointer">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Concluded Section on Dashboard Overview */}
            <div className="space-y-4 pt-4 border-t border-slate-200">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-black text-slate-900">Recently Concluded Classes</h2>
                  <p className="text-xs text-slate-400">Past lectures and student participation history</p>
                </div>
                {concludedClasses.length > 0 && (
                  <button 
                    onClick={() => { setActiveTab('concluded'); setClassesSubTab('concluded'); }}
                    className="text-xs font-bold text-red-600 hover:text-red-700 transition cursor-pointer"
                  >
                    View All Concluded ({concludedClasses.length}) &rarr;
                  </button>
                )}
              </div>

              {concludedClasses.length === 0 ? (
                <div className="bg-white border border-slate-200 p-8 rounded-2xl text-center text-slate-400 text-sm">
                  No concluded classes yet. When sessions conclude, their attendance and records will remain visible here.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {concludedClasses.slice(0, 4).map(cls => (
                    <div key={cls.id} className="bg-slate-50/70 border border-slate-200 p-6 rounded-2xl shadow-sm space-y-4 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          {renderStatusBadge(cls.status)}
                          <span className="text-xs font-medium text-slate-500 bg-white border border-slate-200 px-3 py-1 rounded-full flex items-center gap-1">
                            <Users className="w-3.5 h-3.5 text-slate-400" />
                            {cls.enrolled_students?.length || 0} Registered
                          </span>
                        </div>
                        <h3 className="text-lg font-bold text-slate-800">{cls.title}</h3>
                        <p className="text-slate-500 text-sm line-clamp-2">{cls.description}</p>
                        <p className="text-xs text-slate-400">Ended session • Scheduled: {new Date(cls.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
                      </div>

                      <div className="pt-4 border-t border-slate-200/60 flex flex-wrap justify-between items-center gap-2">
                        <button 
                          onClick={() => handleOpenAttendance(cls.id)}
                          className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                        >
                          <UserCheck className="w-3.5 h-3.5 text-emerald-600" /> View Attendance & Roster
                        </button>
                        <button onClick={() => handleDeleteClass(cls.id)} className="text-slate-400 hover:text-red-600 p-2 transition cursor-pointer" title="Delete class record">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2 & CONCLUDED: CLASS MANAGEMENT INTERFACE */}
        {(activeTab === 'classes' || activeTab === 'concluded') && (
          <div className="space-y-6">
            {/* Sub-tabs header */}
            <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
              <button 
                onClick={() => { setActiveTab('classes'); setClassesSubTab('upcoming'); }}
                className={`px-5 py-2.5 rounded-xl text-sm font-bold transition flex items-center gap-2 cursor-pointer ${
                  (activeTab === 'classes' && classesSubTab === 'upcoming')
                    ? 'bg-red-600 text-white shadow-md shadow-red-600/20' 
                    : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                }`}
              >
                <Video className="w-4 h-4" />
                Upcoming & Active ({upcomingClasses.length})
              </button>
              <button 
                onClick={() => { setActiveTab('concluded'); setClassesSubTab('concluded'); }}
                className={`px-5 py-2.5 rounded-xl text-sm font-bold transition flex items-center gap-2 cursor-pointer ${
                  activeTab === 'concluded' || (activeTab === 'classes' && classesSubTab === 'concluded')
                    ? 'bg-red-600 text-white shadow-md shadow-red-600/20' 
                    : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                }`}
              >
                <Archive className="w-4 h-4" />
                Concluded Classes ({concludedClasses.length})
              </button>
            </div>

            {/* UPCOMING & ACTIVE SUB-VIEW */}
            {((activeTab === 'classes' && classesSubTab === 'upcoming') || (activeTab !== 'concluded' && classesSubTab === 'upcoming')) && (
              upcomingClasses.length === 0 ? (
                <div className="bg-white border border-slate-200 p-12 rounded-2xl text-center space-y-4">
                  <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto">
                    <BookOpen className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">No Upcoming Classes</h3>
                    <p className="text-slate-500 text-sm mt-1">You don't have any scheduled or live lectures right now.</p>
                  </div>
                  <button 
                    onClick={() => setActiveTab('create')}
                    className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-md shadow-red-600/20 transition cursor-pointer"
                  >
                    Create a Class Now
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {upcomingClasses.map(cls => (
                    <div key={cls.id} className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-4 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          {renderStatusBadge(cls.status)}
                          <span className="text-xs font-semibold text-slate-600">
                            Capacity: <strong className="text-red-600 font-bold">{cls.enrolled_students?.length || 0}</strong> {cls.student_limit ? `/ ${cls.student_limit}` : '(No limit)'}
                          </span>
                        </div>
                        <h3 className="text-xl font-bold text-slate-900">{cls.title}</h3>
                        <p className="text-slate-500 text-sm">{cls.description}</p>
                        <p className="text-xs text-slate-500 font-medium">Scheduled: {new Date(cls.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
                      </div>

                      <div className="pt-4 border-t border-slate-100 flex flex-wrap justify-between items-center gap-2">
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => handleStartClass(cls.id, cls.status)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-md shadow-emerald-600/20"
                          >
                            <Video className="w-4 h-4" /> 
                            {cls.status === 'live' ? 'Enter Live Classroom' : 'Host Virtual Session'}
                          </button>
                          <button 
                            onClick={() => handleOpenAttendance(cls.id)}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                          >
                            <UserCheck className="w-3.5 h-3.5 text-slate-500" /> Attendance
                          </button>
                        </div>

                        <button onClick={() => handleDeleteClass(cls.id)} className="bg-red-50 text-red-600 hover:bg-red-100 px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer">
                          Delete Class
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* CONCLUDED SUB-VIEW */}
            {(activeTab === 'concluded' || classesSubTab === 'concluded') && (
              concludedClasses.length === 0 ? (
                <div className="bg-white border border-slate-200 p-12 rounded-2xl text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
                    <Archive className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">No Concluded Classes Yet</h3>
                    <p className="text-slate-500 text-sm mt-1">When your scheduled classes reach their duration or are ended by you, they will remain permanently visible here with full attendance reports.</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {concludedClasses.map(cls => (
                    <div key={cls.id} className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-4 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          {renderStatusBadge(cls.status)}
                          <span className="text-xs font-semibold text-slate-600">
                            Total Registrations: <strong className="text-slate-900 font-bold">{cls.enrolled_students?.length || 0}</strong>
                          </span>
                        </div>
                        <h3 className="text-xl font-bold text-slate-900">{cls.title}</h3>
                        <p className="text-slate-500 text-sm">{cls.description}</p>
                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          <span>Scheduled: {new Date(cls.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                          <span>•</span>
                          <span>Duration: {cls.duration_minutes >= 999999 ? 'Self-Paced' : `${cls.duration_minutes}m`}</span>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-slate-100 flex flex-wrap justify-between items-center gap-2">
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => handleOpenAttendance(cls.id)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-md shadow-emerald-600/20"
                          >
                            <UserCheck className="w-4 h-4" /> View Attendance & Roster
                          </button>
                          <span className="bg-slate-100 text-slate-400 border border-slate-200 text-xs font-semibold px-3 py-2 rounded-xl select-none">
                            Lecture Concluded
                          </span>
                        </div>

                        <button onClick={() => handleDeleteClass(cls.id)} className="text-slate-400 hover:text-red-600 p-2 transition cursor-pointer" title="Delete class record">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}

        {/* TAB 3: CREATE CLASS */}
        {activeTab === 'create' && (
          <div className="max-w-2xl bg-white border border-slate-200/80 p-8 rounded-2xl shadow-sm">
            <form onSubmit={handleCreateClass} className="space-y-6">
              <div>
                <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-2">Class Title</label>
                <input 
                  type="text" 
                  value={title} 
                  onChange={(e) => setTitle(e.target.value)} 
                  required 
                  minLength={3}
                  maxLength={200}
                  placeholder="Advanced Web Development Masterclass"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition"
                />
              </div>

              <div>
                <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-2">Description</label>
                <textarea 
                  value={description} 
                  onChange={(e) => setDescription(e.target.value)} 
                  required 
                  minLength={5}
                  maxLength={3000}
                  rows="3"
                  placeholder="What students will learn..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-2">Start Time</label>
                  <input 
                    type="datetime-local" 
                    value={startTime} 
                    min={minDateTime}
                    onChange={(e) => setStartTime(e.target.value)} 
                    required 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Times are automatically normalized in UTC.</p>
                </div>

                <div>
                  <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-2">Student Limit (Capacity)</label>
                  <select 
                    value={studentLimit} 
                    onChange={(e) => setStudentLimit(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition"
                  >
                    <option value="25">25 Students Max</option>
                    <option value="50">50 Students Max</option>
                    <option value="100">100 Students Max</option>
                    <option value="unlimited">No Limit (Unlimited)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider">Duration</label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={isNoLimitDuration} 
                      onChange={(e) => setIsNoLimitDuration(e.target.checked)}
                      className="w-4 h-4 text-red-600 border-slate-300 rounded focus:ring-red-500"
                    />
                    <span className="text-sm font-medium text-slate-700">No Limit (Self-Paced / Ongoing)</span>
                  </label>
                </div>
                {!isNoLimitDuration && (
                  <input 
                    type="number" 
                    min="10"
                    max="720"
                    value={durationMinutes} 
                    onChange={(e) => setDurationMinutes(e.target.value)}
                    placeholder="Duration in minutes (e.g., 60)"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition"
                  />
                )}
              </div>

              <button 
                type="submit" 
                className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3.5 rounded-xl shadow-lg shadow-red-600/25 transition cursor-pointer"
              >
                Schedule & Create Live Class
              </button>
            </form>
          </div>
        )}

        {/* TAB 4: PROFILE */}
        {activeTab === 'profile' && (
          <div className="max-w-xl bg-white border border-slate-200/80 p-8 rounded-2xl shadow-sm space-y-6">
            <h3 className="text-lg font-bold text-slate-900">Instructor Profile</h3>
            
            <div className="flex items-center gap-6">
              <div className="relative w-20 h-20 rounded-full bg-red-100 text-red-600 font-bold text-3xl flex items-center justify-center overflow-hidden border-2 border-slate-200">
                {profilePicPreview ? (
                  <img src={profilePicPreview} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  user?.full_name?.[0]
                )}
              </div>
              <div className="space-y-2">
                <button 
                  type="button"
                  onClick={openCloudinaryWidget}
                  className="cursor-pointer bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-xs font-semibold transition inline-flex items-center gap-2"
                >
                  <Camera className="w-4 h-4" /> Upload Photo
                </button>
                <p className="text-xs text-slate-400">JPG, PNG or GIF via Cloudinary.</p>
              </div>
            </div>

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
                <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-2">Instructor Bio</label>
                <textarea 
                  value={bio} 
                  onChange={(e) => setBio(e.target.value)}
                  rows="4"
                  placeholder="Tell students about your professional background and expertise..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition"
                />
              </div>

              <button type="submit" className="bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-3 rounded-xl text-sm shadow-md shadow-red-600/20 transition cursor-pointer">
                Save Profile
              </button>
            </form>
          </div>
        )}

        {/* TAB 5: SETTINGS */}
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

              <button type="submit" className="bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-3 rounded-xl text-sm shadow-md shadow-red-600/20 transition cursor-pointer">
                Update Password
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}