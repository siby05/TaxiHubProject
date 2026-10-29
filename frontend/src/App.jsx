import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import Navbar from './components/Navbar';
import ServerWakeBanner from './components/ServerWakeBanner';
import ProtectedRoute from './components/ProtectedRoute';
import RouteMeta from './components/RouteMeta';
import Home from './pages/Home';
const About = lazy(() => import('./pages/About'));
const AirportTransfers = lazy(() => import('./pages/AirportTransfers'));
const NewPlymouthToAuckland = lazy(() => import('./pages/NewPlymouthToAuckland'));
const TransferRoutes = lazy(() => import('./pages/TransferRoutes'));
const Login = lazy(() => import('./pages/Login'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Register = lazy(() => import('./pages/Register'));
const DriverSignup = lazy(() => import('./pages/DriverSignup'));
const Terms = lazy(() => import('./pages/Terms'));
const PassengerDashboard = lazy(() => import('./pages/passenger/PassengerDashboard'));
const PassengerProfile = lazy(() => import('./pages/passenger/PassengerProfile'));
const LodgeComplaint = lazy(() => import('./pages/passenger/LodgeComplaint'));
const MyComplaints = lazy(() => import('./pages/passenger/MyComplaints'));
const BookDriver = lazy(() => import('./pages/passenger/BookDriver'));
const PayBooking = lazy(() => import('./pages/passenger/PayBooking'));
const DriverDashboard = lazy(() => import('./pages/driver/DriverDashboard'));
const DriverComplaints = lazy(() => import('./pages/driver/DriverComplaints'));
const DriverSchedule = lazy(() => import('./pages/driver/DriverSchedule'));
const DriverQrCode = lazy(() => import('./pages/driver/DriverQrCode'));
const DriverSettings = lazy(() => import('./pages/driver/DriverSettings'));
const DriverBookForPassenger = lazy(() => import('./pages/driver/DriverBookForPassenger'));
const DriverAddPassenger = lazy(() => import('./pages/driver/DriverAddPassenger'));
const DriverReports = lazy(() => import('./pages/driver/DriverReports'));
const DriverDocuments = lazy(() => import('./pages/driver/DriverDocuments'));
const DriverExpenses = lazy(() => import('./pages/driver/DriverExpenses'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminComplaints = lazy(() => import('./pages/admin/AdminComplaints'));
const AdminDriverReport = lazy(() => import('./pages/admin/AdminDriverReport'));
import { useAuthStore } from './store/authStore';

// Keep existing printed QR URLs valid while opening the homepage first.
function QrHomeRedirect() {
  const { driverId } = useParams();
  return <Navigate to={`/?qrDriver=${encodeURIComponent(driverId)}`} replace />;
}

export default function App() {
  const { user } = useAuthStore();
  const home = user ? (user.role === 'admin' ? '/admin' : user.role === 'driver' ? '/driver' : '/passenger') : '/login';

  return (
    <>
      <RouteMeta />
      <Navbar />
      <ServerWakeBanner />
      <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={user ? <Navigate to={home} replace /> : <Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/airport-transfers" element={<AirportTransfers />} />
        <Route path="/new-plymouth-to-auckland" element={<NewPlymouthToAuckland />} />
        <Route path="/auckland-to-new-plymouth" element={<TransferRoutes route="auckland" />} />
        <Route path="/new-plymouth-to-palmerston-north" element={<TransferRoutes route="palmerston" />} />
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
        <Route path="/book/:driverId" element={<QrHomeRedirect />} />
        <Route path="/book-direct/:driverId" element={<BookDriver />} />
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
      </Suspense>
    </>
  );
}
