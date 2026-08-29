import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Search, User, BookOpen, Video, Award, Users, Star, Clock, GraduationCap, Filter } from 'lucide-react';
import { API_URL } from '../config';

export default function HomeCatalog() {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [stats, setStats] = useState({ students: 0, classes: 0, teachers: 0, hoursWatched: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('home'); // 'home' or 'courses'

  useEffect(() => {
    // Fetch live classes
    fetch(`${API_URL}/api/classes`)
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setClasses(data); })
      .catch(err => console.error(err));

    // Fetch real-time database stats
    fetch(`${API_URL}/api/stats`)
      .then(res => res.json())
      .then(data => { if (data) setStats(data); })
      .catch(err => console.error(err));
  }, []);

  const handleBook = async (classId) => {
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
        body: JSON.stringify({ class_id: classId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      alert('Successfully booked seat!');
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDashboardRedirect = () => {
    if (!user) {
      navigate('/login');
      return;
    }
    navigate('/dashboard');
  };

  const filteredClasses = classes.filter(cls => 
    cls.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    cls.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Top Navbar */}
      <header className="border-b border-slate-100 sticky top-0 bg-white/80 backdrop-blur-md z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setViewMode('home')}>
            <div className="bg-red-600 text-white p-2.5 rounded-xl shadow-md shadow-red-600/20 flex items-center justify-center">
              <GraduationCap className="w-6 h-6" />
            </div>
            <span className="text-2xl font-extrabold tracking-tight text-slate-900">Madrastak</span>
          </div>

          <nav className="hidden md:flex items-center space-x-8 text-sm font-medium text-slate-600">
            <button onClick={() => setViewMode('home')} className={`transition ${viewMode === 'home' ? 'text-red-600 font-semibold' : 'hover:text-red-600'}`}>Home</button>
            <button onClick={() => setViewMode('courses')} className={`transition ${viewMode === 'courses' ? 'text-red-600 font-semibold' : 'hover:text-red-600'}`}>Courses</button>
            {user && (
              <button onClick={handleDashboardRedirect} className="hover:text-red-600 transition">My Dashboard</button>
            )}
          </nav>

          <div className="flex items-center space-x-4">
            {user ? (
              <div className="flex items-center gap-3">
                <div onClick={handleDashboardRedirect} className="cursor-pointer text-right">
                  <p className="text-sm font-bold text-slate-800">{user.full_name}</p>
                  <p className="text-xs text-red-600 capitalize font-medium">{user.role}</p>
                </div>
                <button onClick={logout} className="text-xs bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg font-medium transition">
                  Logout
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button onClick={() => navigate('/login')} className="text-sm font-semibold text-slate-700 hover:text-red-600 px-4 py-2 transition">
                  Log In
                </button>
                <button onClick={() => navigate('/login')} className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl shadow-lg shadow-red-600/25 transition">
                  Sign Up
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Conditional Views */}
      {viewMode === 'home' ? (
        <>
          {/* Hero Section */}
          <section className="max-w-4xl mx-auto px-6 py-20 text-center space-y-8">
            <h1 className="text-5xl md:text-6xl font-black tracking-tight text-slate-900 leading-[1.15]">
              Learn Smarter. <span className="text-red-600">Grow Faster.</span>
            </h1>
            <p className="text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
              Join students mastering new skills with expert instructors worldwide.
            </p>

            {/* Search Bar */}
            <div className="max-w-2xl mx-auto bg-white border border-slate-200 p-2 rounded-2xl shadow-xl shadow-slate-200/50 flex items-center gap-2">
              <div className="pl-4 text-slate-400">
                <Search className="w-5 h-5" />
              </div>
              <input 
                type="text" 
                placeholder="Search courses..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full py-3 px-2 focus:outline-none text-slate-800 text-sm"
              />
              <button 
                onClick={() => setViewMode('courses')}
                className="bg-red-600 hover:bg-red-700 text-white px-8 py-3.5 rounded-xl font-semibold text-sm shadow-md shadow-red-600/20 transition"
              >
                Search
              </button>
            </div>
          </section>

          {/* Statistics Banner (Real-Time from DB) */}
          <section className="border-y border-slate-100 bg-slate-50/50 py-12">
            <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
              <div className="space-y-1">
                <div className="flex justify-center text-red-600 mb-2"><Users className="w-6 h-6" /></div>
                <h3 className="text-3xl font-black text-slate-900">{stats.students}</h3>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Registered Students</p>
              </div>
              <div className="space-y-1">
                <div className="flex justify-center text-red-600 mb-2"><BookOpen className="w-6 h-6" /></div>
                <h3 className="text-3xl font-black text-slate-900">{stats.classes}</h3>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Scheduled Classes</p>
              </div>
              <div className="space-y-1">
                <div className="flex justify-center text-red-600 mb-2"><Award className="w-6 h-6" /></div>
                <h3 className="text-3xl font-black text-slate-900">{stats.teachers}</h3>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Expert Lecturers</p>
              </div>
              <div className="space-y-1">
                <div className="flex justify-center text-red-600 mb-2"><Star className="w-6 h-6" /></div>
                <h3 className="text-3xl font-black text-slate-900">{stats.hoursWatched}h</h3>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Learning Hours</p>
              </div>
            </div>
          </section>

          {/* Trending Live Classes Catalog Preview */}
          <section id="courses" className="max-w-7xl mx-auto px-6 py-20 space-y-12">
            <div className="flex justify-between items-end">
              <div>
                <h2 className="text-3xl font-black text-slate-900">Trending Live Classes</h2>
                <p className="text-slate-500 text-sm mt-1">Join scheduled sessions hosted by top educators in real-time.</p>
              </div>
              <button onClick={() => setViewMode('courses')} className="text-sm font-semibold text-red-600 hover:text-red-700 transition">
                View All &rarr;
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {filteredClasses.slice(0, 3).map((cls) => (
                <div key={cls.id} className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-lg shadow-slate-100 hover:shadow-xl transition flex flex-col justify-between group">
                  <div>
                    <div className="h-48 bg-slate-900 relative overflow-hidden flex items-center justify-center text-white">
                      <div className="absolute inset-0 bg-gradient-to-tr from-slate-900 to-red-950 opacity-90"></div>
                      <Video className="w-12 h-12 text-red-500 relative z-10 group-hover:scale-110 transition duration-300" />
                      <span className="absolute top-4 right-4 bg-red-600 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                        Live Session
                      </span>
                    </div>
                    <div className="p-6 space-y-3">
                      <h3 className="text-xl font-bold text-slate-900 group-hover:text-red-600 transition">{cls.title}</h3>
                      <p className="text-slate-500 text-sm line-clamp-2">{cls.description}</p>
                      
                      <div className="flex items-center gap-4 text-xs font-medium text-slate-500 pt-2">
                        <span className="flex items-center gap-1"><User className="w-3.5 h-3.5 text-red-600" /> {cls.teacher_name}</span>
                        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-red-600" /> {new Date(cls.start_time).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-6 pt-0 flex justify-between items-center border-t border-slate-100 mt-4">
                    <span className="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg font-medium">{cls.duration_minutes} mins</span>
                    <button 
                      onClick={() => handleBook(cls.id)}
                      className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-md shadow-red-600/20 transition"
                    >
                      Book Seat
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
        /* Full Courses Catalog Page View */
        <section className="max-w-7xl mx-auto px-6 py-12 space-y-8">
          <div>
            <h1 className="text-4xl font-black text-slate-900">Courses</h1>
            <p className="text-slate-500 text-sm mt-1">Explore our comprehensive library of live classes taught by expert instructors.</p>
          </div>

          {/* Search bar inside courses page */}
          <div className="bg-white border border-slate-200 p-2 rounded-2xl shadow-sm flex items-center gap-2 max-w-xl">
            <div className="pl-3 text-slate-400"><Search className="w-5 h-5" /></div>
            <input 
              type="text" 
              placeholder="Search courses..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full py-2 px-1 focus:outline-none text-sm text-slate-800"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-4">
            {filteredClasses.map((cls) => (
              <div key={cls.id} className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition flex flex-col justify-between group">
                <div>
                  <div className="h-48 bg-slate-900 relative overflow-hidden flex items-center justify-center text-white">
                    <div className="absolute inset-0 bg-gradient-to-tr from-slate-900 to-red-950 opacity-90"></div>
                    <Video className="w-12 h-12 text-red-500 relative z-10 group-hover:scale-110 transition duration-300" />
                    <span className="absolute top-4 right-4 bg-red-600 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                      Live Session
                    </span>
                  </div>
                  <div className="p-6 space-y-3">
                    <h3 className="text-xl font-bold text-slate-900 group-hover:text-red-600 transition">{cls.title}</h3>
                    <p className="text-slate-500 text-sm line-clamp-2">{cls.description}</p>
                    
                    <div className="flex items-center gap-4 text-xs font-medium text-slate-500 pt-2">
                      <span className="flex items-center gap-1"><User className="w-3.5 h-3.5 text-red-600" /> {cls.teacher_name}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-red-600" /> {new Date(cls.start_time).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                <div className="p-6 pt-0 flex justify-between items-center border-t border-slate-100 mt-4">
                  <span className="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg font-medium">{cls.duration_minutes} mins</span>
                  <button 
                    onClick={() => handleBook(cls.id)}
                    className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-md shadow-red-600/20 transition"
                  >
                    Book Seat
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}