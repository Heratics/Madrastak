import React, { useContext } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthContext } from './context/AuthContext';
import Login from './pages/Login';
import HomeCatalog from './pages/HomeCatalog';
import StudentDashboard from './pages/StudentDashboard';
import TeacherDashboard from './pages/Dashboard';
import CourseDetail from './pages/CourseDetail';

export default function App() {
  const { user } = useContext(AuthContext);

  return (
    <Routes>
      <Route path="/" element={<HomeCatalog />} />
      <Route path="/course/:id" element={<CourseDetail />} />
      <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
      <Route 
        path="/dashboard" 
        element={
          !user ? (
            <Navigate to="/login" />
          ) : user.role === 'teacher' ? (
            <TeacherDashboard />
          ) : (
            <StudentDashboard />
          )
        } 
      />
    </Routes>
  );
}