import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Register from './pages/Register';
import PassengerDashboard from './pages/passenger/PassengerDashboard';
import LodgeComplaint from './pages/passenger/LodgeComplaint';
import MyComplaints from './pages/passenger/MyComplaints';
import DriverDashboard from './pages/driver/DriverDashboard';
import DriverComplaints from './pages/driver/DriverComplaints';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminComplaints from './pages/admin/AdminComplaints';
import { useAuthStore } from './store/authStore';

export default function App() {
  const { user } = useAuthStore();
  const home = user ? (user.role === 'admin' ? '/admin' : user.role === 'driver' ? '/driver' : '/passenger') : '/login';

  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<Navigate to={home} replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route path="/passenger" element={<ProtectedRoute roles={['passenger']}><PassengerDashboard /></ProtectedRoute>} />
        <Route path="/passenger/complaints" element={<ProtectedRoute roles={['passenger']}><MyComplaints /></ProtectedRoute>} />
        <Route path="/passenger/complaints/new" element={<ProtectedRoute roles={['passenger']}><LodgeComplaint /></ProtectedRoute>} />

        <Route path="/driver" element={<ProtectedRoute roles={['driver']}><DriverDashboard /></ProtectedRoute>} />
        <Route path="/driver/complaints" element={<ProtectedRoute roles={['driver']}><DriverComplaints /></ProtectedRoute>} />

        <Route path="/admin" element={<ProtectedRoute roles={['admin']}><AdminDashboard /></ProtectedRoute>} />
        <Route path="/admin/complaints" element={<ProtectedRoute roles={['admin']}><AdminComplaints /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </>
  );
}
