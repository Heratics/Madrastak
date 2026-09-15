import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { getValidToken } from '../utils/auth';
import { 
  LayoutDashboard, BookOpen, PlusCircle, User, Settings, 
  LogOut, Video, Users, Clock, Trash2, CheckCircle, GraduationCap, 
  X, AlertCircle, Camera, UserCheck, Calendar, ShieldAlert, Archive,
  RotateCcw, Edit3 
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

  // Relaunch Course Modal State
  const [relaunchModal, setRelaunchModal] = useState({
    open: false,
    cls: null,
    mode: 'options', // 'options' | 'pick_time'
    pickedTime: '',
    submitting: false
  });

  // Edit Course Modal State
  const [editModal, setEditModal] = useState({
    open: false,
    classId: null,
    title: '',
    description: '',
    startTime: '',
    isNoLimitDuration: false,
    durationMinutes: '60',
    studentLimit: '20',
    submitting: false
  });

  // Create Class Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('');
  const [isNoLimitDuration, setIsNoLimitDuration] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [studentLimit, setStudentLimit] = useState('20');

  // Profile & Settings State
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [bio, setBio] = useState('');
  const [profilePicPreview, setProfilePicPreview] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const token = getValidToken();

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: 'success' });
    }, 4000);
  };

  const fetchTeacherClasses = async () => {
    try {
      const currentToken = getValidToken() || token;
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

    const parsedLimit = Number(studentLimit);
    if (!studentLimit || !Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 20) {
      showToast('Student limit must be an integer between 1 and 20 (maximum 20 students).', 'error');
      return;
    }

    try {
      const currentToken = getValidToken() || token;
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
          student_limit: parsedLimit
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to schedule class');

      showToast('Class scheduled successfully!');
      setTitle('');
      setDescription('');
      setStartTime('');
      setStudentLimit('20');
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
        const currentToken = getValidToken() || token;
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
      const currentToken = getValidToken() || token;
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

  // --- Relaunch Course Handlers ---
  const handleOpenRelaunch = (cls) => {
    // Default pickedTime to 1 hour from now formatted as local ISO
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const offsetMs = d.getTimezoneOffset() * 60000;
    const localIso = new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);

    setRelaunchModal({
      open: true,
      cls,
      mode: 'options',
      pickedTime: localIso,
      submitting: false
    });
  };

  const handleRelaunchNow = async () => {
    if (!relaunchModal.cls) return;
    setRelaunchModal(prev => ({ ...prev, submitting: true }));
    try {
      const currentToken = getValidToken() || token;
      const res = await fetch(`${API_URL}/api/classes/${relaunchModal.cls.id}/relaunch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        },
        body: JSON.stringify({ immediate: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to relaunch course');

      showToast('Course relaunched successfully! New session is ready.');
      setRelaunchModal({ open: false, cls: null, mode: 'options', pickedTime: '', submitting: false });
      await fetchTeacherClasses();
      setActiveTab('classes');
      setClassesSubTab('upcoming');
    } catch (err) {
      showToast(err.message, 'error');
      setRelaunchModal(prev => ({ ...prev, submitting: false }));
    }
  };

  const handleRelaunchWithTime = async (e) => {
    e.preventDefault();
    if (!relaunchModal.cls) return;
    if (!relaunchModal.pickedTime) {
      showToast('Please select a date and time.', 'error');
      return;
    }
    const chosenTimestamp = new Date(relaunchModal.pickedTime).getTime();
    if (chosenTimestamp < Date.now() - (5 * 60 * 1000)) {
      showToast('Scheduled date and time cannot be in the past.', 'error');
      return;
    }

    setRelaunchModal(prev => ({ ...prev, submitting: true }));
    try {
      const currentToken = getValidToken() || token;
      const res = await fetch(`${API_URL}/api/classes/${relaunchModal.cls.id}/relaunch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        },
        body: JSON.stringify({ start_time: new Date(relaunchModal.pickedTime).toISOString() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to schedule relaunched course');

      showToast('Course relaunched and scheduled successfully!');
      setRelaunchModal({ open: false, cls: null, mode: 'options', pickedTime: '', submitting: false });
      await fetchTeacherClasses();
      setActiveTab('classes');
      setClassesSubTab('upcoming');
    } catch (err) {
      showToast(err.message, 'error');
      setRelaunchModal(prev => ({ ...prev, submitting: false }));
    }
  };

  // --- Edit Course Handlers ---
  const handleOpenEdit = (cls) => {
    let localIso = '';
    if (cls.start_time) {
      const d = new Date(cls.start_time);
      const offsetMs = d.getTimezoneOffset() * 60000;
      localIso = new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
    }
    const isNoLimit = cls.duration_minutes >= 999999;
    setEditModal({
      open: true,
      classId: cls.id,
      title: cls.title || '',
      description: cls.description || '',
      startTime: localIso,
      isNoLimitDuration: isNoLimit,
      durationMinutes: isNoLimit ? '60' : String(cls.duration_minutes || 60),
      studentLimit: String(cls.student_limit || 20),
      submitting: false
    });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editModal.title.trim() || editModal.title.trim().length < 3) {
      showToast('Class title must be at least 3 characters long.', 'error');
      return;
    }
    if (!editModal.description.trim() || editModal.description.trim().length < 5) {
      showToast('Please provide a brief description of the class.', 'error');
      return;
    }
    if (!editModal.startTime) {
      showToast('Please select a scheduled start date and time.', 'error');
      return;
    }

    const finalDuration = editModal.isNoLimitDuration ? 999999 : parseInt(editModal.durationMinutes);
    if (!editModal.isNoLimitDuration && (!finalDuration || finalDuration <= 0)) {
      showToast('Duration must be a positive number of minutes.', 'error');
      return;
    }

    const parsedLimit = Number(editModal.studentLimit);
    if (!editModal.studentLimit || !Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 20) {
      showToast('Student limit must be an integer between 1 and 20 (maximum 20 students).', 'error');
      return;
    }

    setEditModal(prev => ({ ...prev, submitting: true }));
    try {
      const currentToken = getValidToken() || token;
      const res = await fetch(`${API_URL}/api/classes/${editModal.classId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        },
        body: JSON.stringify({
          title: editModal.title.trim(),
          description: editModal.description.trim(),
          start_time: new Date(editModal.startTime).toISOString(),
          duration_minutes: finalDuration,
          student_limit: parsedLimit
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to update course');

      showToast('Course updated successfully!');
      setEditModal({ open: false, classId: null, title: '', description: '', startTime: '', isNoLimitDuration: false, durationMinutes: '60', studentLimit: '20', submitting: false });
      await fetchTeacherClasses();
    } catch (err) {
      showToast(err.message, 'error');
      setEditModal(prev => ({ ...prev, submitting: false }));
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

      {/* Relaunch Course Modal */}
      {relaunchModal.open && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden border border-slate-200 animate-fade-in">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">Relaunch Course</h3>
                  <p className="text-xs text-slate-500">Create a new independent cohort with fresh attendance.</p>
                </div>
              </div>
              <button 
                onClick={() => setRelaunchModal({ open: false, cls: null, mode: 'options', pickedTime: '', submitting: false })}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-1.5 text-xs text-slate-600">
                <div className="font-bold text-sm text-slate-900 truncate">{relaunchModal.cls?.title}</div>
                <p className="line-clamp-2 text-slate-500">{relaunchModal.cls?.description}</p>
                <div className="flex gap-4 pt-1 text-[11px] text-slate-400">
                  <span>Duration: {relaunchModal.cls?.duration_minutes >= 999999 ? 'Self-Paced' : `${relaunchModal.cls?.duration_minutes}m`}</span>
                  <span>•</span>
                  <span>Limit: {relaunchModal.cls?.student_limit || 20} students</span>
                </div>
              </div>

              {relaunchModal.mode === 'options' ? (
                <div className="space-y-3">
                  <button
                    onClick={handleRelaunchNow}
                    disabled={relaunchModal.submitting}
                    className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white p-4 rounded-2xl font-bold text-sm shadow-md shadow-red-600/20 transition flex items-center justify-between cursor-pointer"
                  >
                    <div className="text-left">
                      <div className="font-black">Relaunch Now</div>
                      <div className="text-xs text-white/80 font-normal">Start a new session immediately with zero bookings.</div>
                    </div>
                    <RotateCcw className="w-5 h-5 shrink-0" />
                  </button>

                  <button
                    onClick={() => setRelaunchModal(prev => ({ ...prev, mode: 'pick_time' }))}
                    disabled={relaunchModal.submitting}
                    className="w-full bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 p-4 rounded-2xl font-bold text-sm transition flex items-center justify-between cursor-pointer shadow-sm"
                  >
                    <div className="text-left">
                      <div className="font-black">Pick Date & Time</div>
                      <div className="text-xs text-slate-500 font-normal">Schedule this course for a future date & time.</div>
                    </div>
                    <Calendar className="w-5 h-5 text-slate-400 shrink-0" />
                  </button>

                  <button
                    onClick={() => setRelaunchModal({ open: false, cls: null, mode: 'options', pickedTime: '', submitting: false })}
                    className="w-full py-3 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-700 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <form onSubmit={handleRelaunchWithTime} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      Select Date & Time
                    </label>
                    <input
                      type="datetime-local"
                      value={relaunchModal.pickedTime}
                      onChange={(e) => setRelaunchModal(prev => ({ ...prev, pickedTime: e.target.value }))}
                      min={minDateTime}
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition"
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setRelaunchModal(prev => ({ ...prev, mode: 'options' }))}
                      className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-xl text-xs font-semibold transition cursor-pointer"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={relaunchModal.submitting}
                      className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white py-3 rounded-xl text-xs font-bold shadow-md shadow-red-600/20 transition cursor-pointer"
                    >
                      {relaunchModal.submitting ? 'Scheduling...' : 'Schedule Relaunch'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Course Modal */}
      {editModal.open && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200 animate-fade-in">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center">
                  <Edit3 className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">Edit Course</h3>
                  <p className="text-xs text-slate-500">Update course details and settings.</p>
                </div>
              </div>
              <button 
                onClick={() => setEditModal(prev => ({ ...prev, open: false }))}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-6 overflow-y-auto space-y-5 flex-1">
              <div>
                <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-1.5">Class Title</label>
                <input 
                  type="text" 
                  value={editModal.title} 
                  onChange={(e) => setEditModal(prev => ({ ...prev, title: e.target.value }))} 
                  required 
                  minLength={3}
                  maxLength={200}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition"
                />
              </div>

              <div>
                <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-1.5">Description</label>
                <textarea 
                  value={editModal.description} 
                  onChange={(e) => setEditModal(prev => ({ ...prev, description: e.target.value }))} 
                  required 
                  minLength={5}
                  maxLength={3000}
                  rows="3"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-1.5">Start Date & Time</label>
                  <input 
                    type="datetime-local" 
                    value={editModal.startTime} 
                    onChange={(e) => setEditModal(prev => ({ ...prev, startTime: e.target.value }))} 
                    required 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider">Duration (Minutes)</label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={editModal.isNoLimitDuration}
                        onChange={(e) => setEditModal(prev => ({ ...prev, isNoLimitDuration: e.target.checked }))}
                        className="rounded border-slate-300 text-red-600 focus:ring-0"
                      />
                      No Limit
                    </label>
                  </div>
                  <input 
                    type="number" 
                    value={editModal.durationMinutes} 
                    onChange={(e) => setEditModal(prev => ({ ...prev, durationMinutes: e.target.value }))} 
                    disabled={editModal.isNoLimitDuration}
                    min="1"
                    max="1440"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition disabled:opacity-40"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-1.5">
                  Student Limit (1 to 20 Students)
                </label>
                <div className="flex gap-2">
                  <select
                    value={editModal.studentLimit}
                    onChange={(e) => setEditModal(prev => ({ ...prev, studentLimit: e.target.value }))}
                    className="w-1/2 bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition"
                  >
                    {[...Array(20)].map((_, i) => (
                      <option key={i + 1} value={String(i + 1)}>
                        {i + 1} {i === 0 ? 'student' : 'students'}
                      </option>
                    ))}
                  </select>
                  <input 
                    type="number"
                    min="1"
                    max="20"
                    value={editModal.studentLimit}
                    onChange={(e) => setEditModal(prev => ({ ...prev, studentLimit: e.target.value }))}
                    placeholder="Or type 1-20"
                    className="w-1/2 bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition"
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Maximum 20 students allowed per live class.</p>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditModal(prev => ({ ...prev, open: false }))}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editModal.submitting}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white py-3 rounded-xl text-xs font-bold shadow-md shadow-red-600/20 transition cursor-pointer"
                >
                  {editModal.submitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <button 
                            onClick={() => handleStartClass(cls.id, cls.status)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20 px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                          >
                            <Video className="w-4 h-4" /> 
                            {cls.status === 'live' ? 'Join Live Session' : 'Start Virtual Session'}
                          </button>
                          <button 
                            onClick={() => handleOpenAttendance(cls.id)}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                          >
                            <UserCheck className="w-3.5 h-3.5 text-slate-500" /> Attendance
                          </button>
                          <button 
                            onClick={() => handleOpenEdit(cls)}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                            title="Edit Course"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-slate-600" /> Edit
                          </button>
                          <button 
                            onClick={() => handleOpenRelaunch(cls)}
                            className="bg-blue-50 hover:bg-blue-100 text-blue-600 px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                            title="Relaunch Course"
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> Relaunch
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <button 
                            onClick={() => handleOpenAttendance(cls.id)}
                            className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                          >
                            <UserCheck className="w-3.5 h-3.5 text-emerald-600" /> Attendance
                          </button>
                          <button 
                            onClick={() => handleOpenRelaunch(cls)}
                            className="bg-red-50 hover:bg-red-100 text-red-600 px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                            title="Relaunch this concluded course"
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> Relaunch
                          </button>
                          <button 
                            onClick={() => handleOpenEdit(cls)}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                            title="Edit Course"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-slate-600" /> Edit
                          </button>
                        </div>
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <button 
                            onClick={() => handleStartClass(cls.id, cls.status)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-md shadow-emerald-600/20"
                          >
                            <Video className="w-4 h-4" /> 
                            {cls.status === 'live' ? 'Enter Live Classroom' : 'Host Virtual Session'}
                          </button>
                          <button 
                            onClick={() => handleOpenAttendance(cls.id)}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                          >
                            <UserCheck className="w-3.5 h-3.5 text-slate-500" /> Attendance
                          </button>
                          <button 
                            onClick={() => handleOpenEdit(cls)}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                            title="Edit Course"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-slate-600" /> Edit
                          </button>
                          <button 
                            onClick={() => handleOpenRelaunch(cls)}
                            className="bg-blue-50 hover:bg-blue-100 text-blue-600 px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                            title="Relaunch Course"
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> Relaunch
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <button 
                            onClick={() => handleOpenAttendance(cls.id)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-md shadow-emerald-600/20"
                          >
                            <UserCheck className="w-4 h-4" /> View Attendance
                          </button>
                          <button 
                            onClick={() => handleOpenRelaunch(cls)}
                            className="bg-red-50 hover:bg-red-100 text-red-600 px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                            title="Relaunch this concluded course"
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> Relaunch
                          </button>
                          <button 
                            onClick={() => handleOpenEdit(cls)}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                            title="Edit Course"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-slate-600" /> Edit
                          </button>
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
                  <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-2">
                    Student Limit (1 – 20 Students)
                  </label>
                  <div className="flex gap-2">
                    <input 
                      type="number" 
                      min="1" 
                      max="20" 
                      step="1"
                      value={studentLimit} 
                      onChange={(e) => setStudentLimit(e.target.value)}
                      placeholder="1 - 20"
                      className="w-1/2 bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition font-semibold"
                      required
                    />
                    <select 
                      value={Array.from({ length: 20 }, (_, i) => String(i + 1)).includes(String(studentLimit).trim()) ? String(studentLimit).trim() : ''} 
                      onChange={(e) => setStudentLimit(e.target.value)}
                      className="w-1/2 bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 transition cursor-pointer"
                    >
                      <option value="" disabled>Select limit...</option>
                      {Array.from({ length: 20 }, (_, i) => i + 1).map((num) => (
                        <option key={num} value={num}>
                          {num} {num === 1 ? 'Student' : 'Students'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">Select from dropdown or type a number between 1 and 20 (max 20 students).</p>
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