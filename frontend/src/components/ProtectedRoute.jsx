import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function ProtectedRoute({ roles, children }) {
  const { user } = useAuthStore();
  const location = useLocation();
  // Preserve the page being requested so Login can send the user straight
  // back to it (e.g. a WhatsApp payment link opened while logged out) -
  // matches the same location.state.from pattern Login.jsx already reads.
  if (!user) return <Navigate to="/login" state={{ from: `${location.pathname}${location.search}` }} replace />;
  if (roles && !roles.includes(user.role)) {
    const home = user.role === 'admin' ? '/admin' : user.role === 'driver' ? '/driver' : '/passenger';
    return <Navigate to={home} replace />;
  }
  return children;
}
