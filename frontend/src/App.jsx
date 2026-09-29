import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import ServerWakeBanner from './components/ServerWakeBanner';
import ProtectedRoute from './components/ProtectedRoute';
import RouteMeta from './components/RouteMeta';
import Home from './pages/Home';
import About from './pages/About';
import AirportTransfers from './pages/AirportTransfers';
import NewPlymouthToAuckland from './pages/NewPlymouthToAuckland';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Register from './pages/Register';
import DriverSignup from './pages/DriverSignup';
import Terms from './pages/Terms';
import PassengerDashboard from './pages/passenger/PassengerDashboard';
import PassengerProfile from './pages/passenger/PassengerProfile';
import LodgeComplaint from './pages/passenger/LodgeComplaint';
import MyComplaints from './pages/passenger/MyComplaints';
import BookDriver from './pages/passenger/BookDriver';
import PayBooking from './pages/passenger/PayBooking';
import DriverDashboard from './pages/driver/DriverDashboard';
import DriverComplaints from './pages/driver/DriverComplaints';
import DriverSchedule from './pages/driver/DriverSchedule';
import DriverQrCode from './pages/driver/DriverQrCode';
import DriverSettings from './pages/driver/DriverSettings';
import DriverBookForPassenger from './pages/driver/DriverBookForPassenger';
import DriverAddPassenger from './pages/driver/DriverAddPassenger';
import DriverReports from './pages/driver/DriverReports';
import DriverDocuments from './pages/driver/DriverDocuments';
import DriverExpenses from './pages/driver/DriverExpenses';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminComplaints from './pages/admin/AdminComplaints';
import AdminDriverReport from './pages/admin/AdminDriverReport';
import { useAuthStore } from './store/authStore';

export default function App() {
  const { user } = useAuthStore();
  const home = user ? (user.role === 'admin' ? '/admin' : user.role === 'driver' ? '/driver' : '/passenger') : '/login';

  return (
    <>
      <RouteMeta />
      <Navbar />
      <ServerWakeBanner />
      <Routes>
        <Route path="/" element={user ? <Navigate to={home} replace /> : <Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/airport-transfers" element={<AirportTransfers />} />
        <Route path="/new-plymouth-to-auckland" element={<NewPlymouthToAuckland />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password/:token" element={<ResetPassword />} />
        <Route path="/register" element={<Register />} />
        <Route path="/driver-signup" element={<DriverSignup />} />
        <Route path="/terms" element={<Terms />} />

        <Route path="/passenger" element={<ProtectedRoute roles={['passenger']}><PassengerDashboard /></ProtectedRoute>} />
        <Route path="/passenger/profile" element={<ProtectedRoute roles={['passenger']}><PassengerProfile /></ProtectedRoute>} />
        <Route path="/passenger/complaints" element={<ProtectedRoute roles={['passenger']}><MyComplaints /></ProtectedRoute>} />
        <Route path="/passenger/complaints/new" element={<ProtectedRoute roles={['passenger']}><LodgeComplaint /></ProtectedRoute>} />
        <Route path="/book/:driverId" element={<BookDriver />} />
        <Route path="/pay/:bookingId" element={<ProtectedRoute roles={['passenger']}><PayBooking /></ProtectedRoute>} />

        <Route path="/driver" element={<ProtectedRoute roles={['driver']}><DriverDashboard /></ProtectedRoute>} />
        <Route path="/driver/schedule" element={<ProtectedRoute roles={['driver']}><DriverSchedule /></ProtectedRoute>} />
        <Route path="/driver/qr-code" element={<ProtectedRoute roles={['driver']}><DriverQrCode /></ProtectedRoute>} />
        <Route path="/driver/settings" element={<ProtectedRoute roles={['driver']}><DriverSettings /></ProtectedRoute>} />
        <Route path="/driver/book" element={<ProtectedRoute roles={['driver']}><DriverBookForPassenger /></ProtectedRoute>} />
        <Route path="/driver/passengers/new" element={<ProtectedRoute roles={['driver']}><DriverAddPassenger /></ProtectedRoute>} />
        <Route path="/driver/complaints" element={<ProtectedRoute roles={['driver']}><DriverComplaints /></ProtectedRoute>} />
        <Route path="/driver/reports" element={<ProtectedRoute roles={['driver']}><DriverReports /></ProtectedRoute>} />
        <Route path="/driver/documents" element={<ProtectedRoute roles={['driver']}><DriverDocuments /></ProtectedRoute>} />
        <Route path="/driver/expenses" element={<ProtectedRoute roles={['driver']}><DriverExpenses /></ProtectedRoute>} />

        <Route path="/admin" element={<ProtectedRoute roles={['admin']}><AdminDashboard /></ProtectedRoute>} />
        <Route path="/admin/complaints" element={<ProtectedRoute roles={['admin']}><AdminComplaints /></ProtectedRoute>} />
        <Route path="/admin/drivers/:driverId/report" element={<ProtectedRoute roles={['admin']}><AdminDriverReport /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </>
  );
}
