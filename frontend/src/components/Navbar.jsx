import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import NotificationBell from './NotificationBell';

export default function Navbar() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const home = user?.role === 'admin' ? '/admin' : user?.role === 'driver' ? '/driver' : '/passenger';

  return (
    <div className="navbar">
      <Link className="brand" to={user ? home : '/login'}>🚖 TaxiHub</Link>
      <nav>
        {user ? (
          <>
            {user.role === 'passenger' && (
              <>
                <Link to="/passenger">Book a ride</Link>
                <Link to="/passenger/complaints">My complaints</Link>
              </>
            )}
            {user.role === 'driver' && (
              <>
                <Link to="/driver">Trips</Link>
                <Link to="/driver/book">Book for passenger</Link>
                <Link to="/driver/schedule">Schedule</Link>
                <Link to="/driver/qr-code">My QR code</Link>
                <Link to="/driver/billing">Fees</Link>
                <Link to="/driver/complaints">Complaints</Link>
              </>
            )}
            {user.role === 'admin' && (
              <>
                <Link to="/admin">Dashboard</Link>
                <Link to="/admin/complaints">Complaints</Link>
              </>
            )}
            <NotificationBell />
            <span className="muted" style={{ color: '#cbd5e1' }}>{user.name} · {user.role}</span>
            <button onClick={() => { logout(); navigate('/login'); }}>Log out</button>
          </>
        ) : (
          <>
            <Link to="/login">Log in</Link>
            <Link to="/register">Sign up</Link>
          </>
        )}
      </nav>
    </div>
  );
}
