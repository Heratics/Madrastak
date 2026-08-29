import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { Calendar, Video, PlusCircle, User, Clock, Trash2, Users, LogIn } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();

  const [classes, setClasses] = useState([]);
  const [teacherClasses, setTeacherClasses] = useState([]);
  const [studentBookings, setStudentBookings] = useState([]);
  const [activeTab, setActiveTab] = useState('catalog'); // 'catalog' or 'my-bookings'

  // Teacher form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('');
  const [duration, setDuration] = useState(60);

  const fetchData = async () => {
    const token = localStorage.getItem('token');
    try {
      // Always fetch public catalog so anyone can see it
      const res = await fetch('http://localhost:5000/api/classes');
      const data = await res.json();
      if (res.ok) setClasses(data);

      if (user?.role === 'teacher') {
        const tRes = await fetch('http://localhost:5000/api/teacher/classes', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const tData = await tRes.json();
        if (tRes.ok) setTeacherClasses(tData);
      } else if (user?.role === 'student') {
        const bRes = await fetch('http://localhost:5000/api/student/bookings', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const bData = await bRes.json();
        if (bRes.ok) setStudentBookings(bData);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const handleCreateClass = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    try {
      const res = await fetch('http://localhost:5000/api/classes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title, description, start_time: startTime, duration_minutes: parseInt(duration) })
      });
      if (!res.ok) throw new Error('Failed to create class');
      alert('Class scheduled successfully!');
      setTitle(''); setDescription(''); setStartTime('');
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteClass = async (classId) => {
    if (!confirm('Are you sure you want to delete this class?')) return;
    const token = localStorage.getItem('token');
    try {
      await fetch(`http://localhost:5000/api/classes/${classId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleBookClass = async (classId) => {
    if (!user) {
      alert('Please log in or register to book a seat.');
      navigate('/login');
      return;
    }

    const token = localStorage.getItem('token');
    try {
      const res = await fetch('http://localhost:5000/api/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ class_id: classId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      alert('Successfully booked seat!');
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Navbar */}
      <nav className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center space-x-3 cursor-pointer" onClick={() => navigate('/')}>
          <div className="bg-indigo-600 p-2 rounded-xl">
            <Video className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold tracking-wide">Madrastak</span>
        </div>

        <div className="flex items-center space-x-4">
          {user ? (
            <>
              <div className="text-right">
                <p className="font-medium text-sm">{user.full_name}</p>
                <p className="text-xs text-indigo-400 capitalize">{user.role}</p>
              </div>
              <button onClick={logout} className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm transition">
                Log Out
              </button>
            </>
          ) : (
            <button onClick={() => navigate('/login')} className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2">
              <LogIn className="w-4 h-4" /> Log In / Sign Up
            </button>
          )}
        </div>
      </nav>

      <main className="max-w-6xl mx-auto p-6 space-y-8">
        
        {/* TEACHER DASHBOARD */}
        {user?.role === 'teacher' && (
          <div className="space-y-6">
            <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl shadow-lg">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <PlusCircle className="text-indigo-400" /> Schedule a Live Class
              </h2>
              <form onSubmit={handleCreateClass} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 text-sm mb-1">Class Title</label>
                  <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g., Advanced JavaScript" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <label className="block text-slate-300 text-sm mb-1">Start Time</label>
                  <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} required className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:border-indigo-500" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-slate-300 text-sm mb-1">Description</label>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows="2" placeholder="Session details..." className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:border-indigo-500"></textarea>
                </div>
                <div>
                  <label className="block text-slate-300 text-sm mb-1">Duration (Minutes)</label>
                  <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} required className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:border-indigo-500" />
                </div>
                <div className="flex items-end">
                  <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 font-semibold py-3 rounded-lg transition">Publish Class Room</button>
                </div>
              </form>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">My Managed Classes & Student Rosters</h2>
              {teacherClasses.length === 0 ? (
                <p className="text-slate-400 bg-slate-800 p-6 rounded-xl border border-slate-700 text-center">You haven't scheduled any classes yet.</p>
              ) : (
                <div className="space-y-4">
                  {teacherClasses.map((cls) => (
                    <div key={cls.id} className="bg-slate-800 border border-slate-700 p-6 rounded-2xl flex flex-col md:flex-row justify-between gap-6">
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xl font-bold text-white">{cls.title}</h3>
                          <button onClick={() => handleDeleteClass(cls.id)} className="text-red-400 hover:text-red-300 p-1"><Trash2 className="w-5 h-5" /></button>
                        </div>
                        <p className="text-slate-300 text-sm">{cls.description}</p>
                        <p className="text-xs text-indigo-400 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {new Date(cls.start_time).toLocaleString()}</p>
                        
                        <div className="mt-4 pt-4 border-t border-slate-700">
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                            <Users className="w-4 h-4 text-indigo-400" /> Enrolled Students ({cls.enrolled_students.length})
                          </p>
                          {cls.enrolled_students.length === 0 ? (
                            <p className="text-xs text-slate-500 italic">No students registered yet.</p>
                          ) : (
                            <ul className="space-y-1">
                              {cls.enrolled_students.map(student => (
                                <li key={student.id} className="text-xs bg-slate-900/60 px-3 py-1.5 rounded-md flex justify-between text-slate-300">
                                  <span>{student.full_name}</span>
                                  <span className="text-slate-500">{student.email}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col justify-center items-end border-t md:border-t-0 md:border-l border-slate-700 pt-4 md:pt-0 md:pl-6">
                        <a href={`https://meet.jit.si/${cls.meeting_room_id}`} target="_blank" rel="noopener noreferrer" className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-6 py-3 rounded-xl flex items-center gap-2 transition shadow-lg text-center">
                          <Video className="w-5 h-5" /> Launch Live Room
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* PUBLIC & STUDENT VIEW */}
        {user?.role !== 'teacher' && (
          <div className="space-y-6">
            
            {/* Student Navigation Tabs */}
            {user?.role === 'student' && (
              <div className="flex space-x-2 border-b border-slate-700 pb-4">
                <button 
                  onClick={() => setActiveTab('catalog')} 
                  className={`px-4 py-2 rounded-lg font-semibold text-sm transition ${activeTab === 'catalog' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
                >
                  Explore Catalog
                </button>
                <button 
                  onClick={() => setActiveTab('my-bookings')} 
                  className={`px-4 py-2 rounded-lg font-semibold text-sm transition ${activeTab === 'my-bookings' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
                >
                  My Booked Classes ({studentBookings.length})
                </button>
              </div>
            )}

            {/* CATALOG TAB */}
            {activeTab === 'catalog' && (
              <div>
                <div className="mb-6">
                  <h1 className="text-3xl font-bold">Explore Live Learning Sessions</h1>
                  <p className="text-slate-400 text-sm mt-1">Browse upcoming classes offered by expert instructors. Book your seat instantly.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {classes.map((cls) => (
                    <div key={cls.id} className="bg-slate-800 border border-slate-700 p-6 rounded-2xl flex flex-col justify-between shadow-md">
                      <div>
                        <h3 className="text-xl font-bold text-white mb-2">{cls.title}</h3>
                        <p className="text-slate-300 text-sm mb-4">{cls.description}</p>
                        <div className="space-y-2 text-sm text-slate-400">
                          <p className="flex items-center gap-2"><User className="w-4 h-4 text-indigo-400" /> Teacher: <span className="text-white font-medium">{cls.teacher_name}</span></p>
                          <p className="flex items-center gap-2"><Clock className="w-4 h-4 text-indigo-400" /> Starts: <span className="text-white font-medium">{new Date(cls.start_time).toLocaleString()}</span></p>
                        </div>
                      </div>
                      <div className="mt-6 pt-4 border-t border-slate-700 flex justify-between items-center">
                        <span className="text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-3 py-1 rounded-full font-medium">{cls.duration_minutes} Minutes</span>
                        <button onClick={() => handleBookClass(cls.id)} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition">
                          Book Seat
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STUDENT BOOKINGS TAB */}
            {activeTab === 'my-bookings' && user?.role === 'student' && (
              <div>
                <h1 className="text-3xl font-bold mb-6">My Personal Schedule & Classrooms</h1>
                {studentBookings.length === 0 ? (
                  <p className="text-slate-400 bg-slate-800 p-6 rounded-xl border border-slate-700 text-center">You haven't booked any classes yet. Head to the catalog to reserve a seat!</p>
                ) : (
                  <div className="space-y-4">
                    {studentBookings.map((cls) => (
                      <div key={cls.id} className="bg-slate-800 border border-slate-700 p-6 rounded-2xl flex flex-col md:flex-row justify-between gap-6 items-center">
                        <div className="space-y-2 flex-1">
                          <h3 className="text-xl font-bold text-white">{cls.title}</h3>
                          <p className="text-slate-300 text-sm">{cls.description}</p>
                          <div className="flex gap-4 text-xs text-slate-400">
                            <span className="flex items-center gap-1"><User className="w-3.5 h-3.5 text-indigo-400" /> {cls.teacher_name}</span>
                            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-indigo-400" /> {new Date(cls.start_time).toLocaleString()}</span>
                          </div>
                        </div>

                        <div>
                          <a href={`https://meet.jit.si/${cls.meeting_room_id}`} target="_blank" rel="noopener noreferrer" className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-6 py-3 rounded-xl flex items-center gap-2 transition shadow-lg">
                            <Video className="w-5 h-5" /> Join Classroom
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        )}

      </main>
    </div>
  );
}