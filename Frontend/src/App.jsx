import React, { useContext } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthContext } from './context/AuthContext';
import Login from './pages/Login';
import HomeCatalog from './pages/HomeCatalog';
import StudentDashboard from './pages/StudentDashboard';
import Dashboard from './pages/Dashboard'; // Teacher management view

export default function App() {
  const { user } = useContext(AuthContext);

  return (
    <Routes>
      <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
      <Route path="/dashboard" element={user?.role === 'teacher' ? <Dashboard /> : <StudentDashboard />} />
      <Route path="/" element={user?.role === 'teacher' ? <Dashboard /> : <HomeCatalog />} />
    </Routes>
  );
}