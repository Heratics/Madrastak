import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, BookOpen, PlusCircle, User, Settings, 
  LogOut, Video, Users, Clock, Trash2, CheckCircle, GraduationCap, X, AlertCircle, Camera 
} from 'lucide-react';
import { API_URL } from '../config';

export default function TeacherDashboard() {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [classes, setClasses] = useState([]);
  
  // Custom Toast Popup State
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  // Create Class Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('');
  const [isNoLimitDuration, setIsNoLimitDuration] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [studentLimit, setStudentLimit] = useState('25');

  // Profile & Settings State
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [profilePicPreview, setProfilePicPreview] = useState(user?.profile_pic || '');
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
      const res = await fetch(`${API_URL}/api/teacher/classes`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (Array.isArray(data)) setClasses(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchTeacherClasses();
  }, []);

  // Cloudinary Widget Integration
  const openCloudinaryWidget = () => {
    window.cloudinary.createUploadWidget(
      {
        cloudName: 'dxq2w5z2z', // Replace with your actual Cloudinary cloud name if different
        uploadPreset: 'madrastak_presets', // Replace with your actual Cloudinary unsigned upload preset name
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
      
      // Instantly update user context object locally if available
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
    const finalDuration = isNoLimitDuration ? 999999 : parseInt(durationMinutes);

    try {
      const res = await fetch(`${API_URL}/api/classes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          title,
          description,
          start_time: startTime,
          duration_minutes: finalDuration,
          student_limit: studentLimit
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      showToast('Class scheduled successfully!');
      setTitle('');
      setDescription('');
      setStartTime('');
      setActiveTab('classes');
      fetchTeacherClasses();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteClass = async (classId) => {
    if (!window.confirm('Are you sure you want to delete this class?')) return;
    try {
      const res = await fetch(`${API_URL}/api/classes/${classId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to delete class');
      showToast('Class deleted successfully.');
      fetchTeacherClasses();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

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
            <button onClick={() => setActiveTab('classes')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeTab === 'classes' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}>
              <BookOpen className="w-5 h-5" /> My Classes
            </button>
            <button onClick={() => setActiveTab('create')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${activeTab === 'create' ? 'bg-red-50 text-red-600 font-semibold' : 'hover:bg-slate-50'}`}>
              <PlusCircle className="w-5 h-5" /> Create Class
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
            <h1 className="text-2xl font-black text-slate-900 capitalize">{activeTab}</h1>
            <p className="text-slate-500 text-sm mt-0.5">Welcome back, {user?.full_name} (Instructor)</p>
          </div>
          <button onClick={() => navigate('/')} className="text-xs bg-slate-100 hover:bg-slate-200 px-4 py-2.5 rounded-xl font-semibold transition text-slate-700">
            View Public Site
          </button>
        </div>

        {/* TAB 1: DASHBOARD OVERVIEW */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-2">
                <div className="text-red-600"><BookOpen className="w-6 h-6" /></div>
                <h3 className="text-3xl font-black text-slate-900">{classes.length}</h3>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Classes Hosted</p>
              </div>
              <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-2">
                <div className="text-emerald-600"><Users className="w-6 h-6" /></div>
                <h3 className="text-3xl font-black text-slate-900">
                  {classes.reduce((acc, c) => acc + (c.enrolled_students?.length || 0), 0)}
                </h3>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Registered Students</p>
              </div>
              <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-2">
                <div className="text-blue-600"><Video className="w-6 h-6" /></div>
                <h3 className="text-3xl font-black text-slate-900">{classes.filter(c => new Date(c.start_time) > new Date()).length}</h3>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Upcoming Live Sessions</p>
              </div>
            </div>

            <div className="space-y-6">
              <h2 className="text-xl font-black text-slate-900">Your Classes & Registered Students</h2>
              {classes.length === 0 ? (
                <div className="bg-white border border-slate-200 p-8 rounded-2xl text-center text-slate-500">
                  You haven't scheduled any classes yet. Click "Create Class" to start teaching!
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {classes.map(cls => (
                    <div key={cls.id} className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-4 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          <span className="bg-red-50 text-red-600 text-xs font-bold px-3 py-1 rounded-full">Virtual Classroom</span>
                          <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" /> {cls.enrolled_students?.length || 0} Students Registered
                          </span>
                        </div>
                        <h3 className="text-xl font-bold text-slate-900">{cls.title}</h3>
                        <p className="text-slate-500 text-sm line-clamp-2">{cls.description}</p>
                        <p className="text-xs text-slate-400">Scheduled: {new Date(cls.start_time).toLocaleString()}</p>
                      </div>
                      <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
                        <a 
                          href={`https://meet.jit.si/${cls.meeting_room_id}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5"
                        >
                          <Video className="w-4 h-4" /> Start Virtual Session
                        </a>
                        <button onClick={() => handleDeleteClass(cls.id)} className="text-slate-400 hover:text-red-600 p-2 transition">
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

        {/* TAB 2: MY CLASSES */}
        {activeTab === 'classes' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {classes.map(cls => (
                <div key={cls.id} className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-4">
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold text-slate-900">{cls.title}</h3>
                    <p className="text-slate-500 text-sm">{cls.description}</p>
                    <p className="text-xs font-semibold text-slate-600">Students Registered: <span className="text-red-600 font-bold">{cls.enrolled_students?.length || 0}</span></p>
                  </div>
                  <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
                    <span className="text-xs text-slate-500">{new Date(cls.start_time).toLocaleString()}</span>
                    <button onClick={() => handleDeleteClass(cls.id)} className="bg-red-50 text-red-600 hover:bg-red-100 px-4 py-2 rounded-xl text-xs font-semibold transition">
                      Delete Class
                    </button>
                  </div>
                </div>
              ))}
            </div>
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
                    onChange={(e) => setStartTime(e.target.value)} 
                    required 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-2">Student Limit</label>
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
                    value={durationMinutes} 
                    onChange={(e) => setDurationMinutes(e.target.value)}
                    placeholder="Duration in minutes (e.g., 60)"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition"
                  />
                )}
              </div>

              <button 
                type="submit" 
                className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3.5 rounded-xl shadow-lg shadow-red-600/25 transition"
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
            
            {/* Profile Picture Uploader via Cloudinary */}
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

              <button type="submit" className="bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-3 rounded-xl text-sm shadow-md shadow-red-600/20 transition">
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

              <button type="submit" className="bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-3 rounded-xl text-sm shadow-md shadow-red-600/20 transition">
                Update Password
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}