import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { onServerStatus } from '../api/client';

export function useServerStatus() {
  const [status, setStatus] = useState('checking');
  useEffect(() => onServerStatus(setStatus), []);
  return status;
}

export default function ProtectedRoute({ roles, children }) {
  const { user } = useAuthStore();
  const location = useLocation();
  const serverStatus = useServerStatus();
  // Preserve the page being requested so Login can send the user straight
  // back to it (e.g. a WhatsApp payment link opened while logged out) -
  // matches the same location.state.from pattern Login.jsx already reads.
  const from = `${location.pathname}${location.search}`;
  if (!user) return <Navigate to="/login" state={{ from }} replace />;
  if (roles && !roles.includes(user.role)) {
    const home = user.role === 'admin' ? '/admin' : user.role === 'driver' ? '/driver' : '/passenger';
    return <Navigate to={home} replace />;
  }
  // The backend (Render free plan) sleeps when idle. Rather than a
  // dashboard with no records while it boots, show the login screen - it
  // says the server is starting and comes back here by itself once it's up
  // (see Login.jsx).
  if (serverStatus === 'asleep') return <Navigate to="/login" state={{ from, serverAsleep: true }} replace />;
  if (serverStatus === 'checking') return <div className="container"><p className="muted">Connecting...</p></div>;
  return children;
}
