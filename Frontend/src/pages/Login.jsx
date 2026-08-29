import React, { useState, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { API_URL } from '../config';

export default function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('student');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  
  const { login } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const endpoint = isRegister ? `${API_URL}/api/register` : `${API_URL}/api/login`;
    const payload = isRegister 
      ? { full_name: fullName, email, password, role }
      : { email, password };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Something went wrong');

      if (isRegister) {
        alert('Registration successful! Please log in.');
        setIsRegister(false);
      } else {
        login(data.token, data.user);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between p-6">
      {/* Top Bar */}
      <div className="max-w-7xl mx-auto w-full flex justify-between items-center">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
          <div className="bg-red-600 text-white p-2 rounded-xl shadow-md shadow-red-600/20 flex items-center justify-center">
            <GraduationCap className="w-5 h-5" />
          </div>
          <span className="text-xl font-extrabold tracking-tight text-slate-900">Madrastak</span>
        </div>
        <button 
          onClick={() => navigate('/')} 
          className="text-sm font-semibold text-slate-600 hover:text-red-600 flex items-center gap-2 transition"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </button>
      </div>

      {/* Auth Card */}
      <div className="max-w-md w-full mx-auto bg-white border border-slate-200/80 p-8 rounded-2xl shadow-xl shadow-slate-100 my-auto">
        <div className="text-center mb-8 space-y-2">
          <h2 className="text-3xl font-black text-slate-900">
            {isRegister ? 'Join Madrastak' : 'Welcome Back'}
          </h2>
          <p className="text-slate-500 text-sm">
            {isRegister ? 'Create your account to start learning' : 'Log in to access your live classes'}
          </p>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-xl mb-6 text-sm font-medium">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-5">
          {isRegister && (
            <div>
              <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-2">Full Name</label>
              <input 
                type="text" 
                value={fullName} 
                onChange={(e) => setFullName(e.target.value)} 
                required 
                autoComplete="name"
                placeholder="Ahmad Alshara"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 focus:bg-white transition"
              />
            </div>
          )}

          <div>
            <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-2">Email Address</label>
            <input 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              required 
              autoComplete="email"
              placeholder="name@example.com"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 focus:bg-white transition"
            />
          </div>

          <div>
            <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-2">Password</label>
            <div className="relative">
              <input 
                type={showPassword ? "text" : "password"} 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                required 
                autoComplete={isRegister ? "new-password" : "current-password"}
                placeholder="••••••••"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 pr-12 text-slate-900 text-sm focus:outline-none focus:border-red-600 focus:bg-white transition"
              />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {isRegister && (
            <div>
              <label className="block text-slate-700 text-xs font-bold uppercase tracking-wider mb-2">I am a:</label>
              <select 
                value={role} 
                onChange={(e) => setRole(e.target.value)} 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 text-sm focus:outline-none focus:border-red-600 focus:bg-white transition"
              >
                <option value="student">Student</option>
                <option value="teacher">Teacher</option>
              </select>
            </div>
          )}

          {!isRegister && (
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={rememberMe} 
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 text-red-600 border-slate-300 rounded focus:ring-red-500"
                />
                <span className="text-slate-600 font-medium">Remember me for 30 days</span>
              </label>
            </div>
          )}

          <button 
            type="submit" 
            className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3.5 rounded-xl shadow-lg shadow-red-600/25 transition"
          >
            {isRegister ? 'Create Account' : 'Log In'}
          </button>
        </form>

        <div className="mt-8 text-center border-t border-slate-100 pt-6">
          <button 
            onClick={() => setIsRegister(!isRegister)} 
            className="text-sm font-semibold text-red-600 hover:text-red-700 transition"
          >
            {isRegister ? 'Already have an account? Log in' : "Don't have an account? Sign up"}
          </button>
        </div>
      </div>

      <div className="text-center text-xs text-slate-400">
        &copy; 2026 Madrastak. All rights reserved.
      </div>
    </div>
  );
}