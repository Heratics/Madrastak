import { useContext } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthContext } from './context/AuthContext';
import Login from './pages/Login';
import HomeLanding from './pages/HomeLanding';
import HomeCatalog from './pages/HomeCatalog';
import StudentDashboard from './pages/StudentDashboard';
import TeacherDashboard from './pages/Dashboard';
import CourseDetail from './pages/CourseDetail';
import Classroom from './pages/Classroom';
import AccountStatus from './pages/AccountStatus';
import AdminDashboard from './pages/AdminDashboard';
import ThreeAlamatakPage from './pages/ThreeAlamatakPage';

export default function App() {
  const { user } = useContext(AuthContext);

  return (
    <Routes>
      <Route path="/" element={<HomeLanding />} />
      <Route path="/home" element={<HomeCatalog />} />
      <Route path="/madrastak" element={<HomeCatalog />} />
      <Route path="/course/:id" element={<CourseDetail />} />
      <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
      <Route path="/ahmadadminpage" element={<AdminDashboard />} />
      <Route path="/3alamatak" element={<ThreeAlamatakPage />} />
      <Route 
        path="/classroom/:id" 
        element={!user ? <Navigate to="/login" /> : <Classroom />} 
      />
      <Route 
        path="/dashboard" 
        element={
          !user ? (
            <Navigate to="/login" />
          ) : user.role === 'teacher' && user.account_status && user.account_status !== 'active' ? (
            <AccountStatus status={user.account_status} />
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