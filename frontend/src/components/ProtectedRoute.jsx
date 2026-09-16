import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function ProtectedRoute({ roles, children }) {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    const home = user.role === 'admin' ? '/admin' : user.role === 'driver' ? '/driver' : '/passenger';
    return <Navigate to={home} replace />;
  }
  return children;
}
