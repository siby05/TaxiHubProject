import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import client from '../api/client';
import NotificationBell from './NotificationBell';
import Logo from './Logo';

export default function Navbar() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [driverSignupEnabled, setDriverSignupEnabled] = useState(true);

  useEffect(() => {
    client.get('/driver-signup/enabled').then((r) => setDriverSignupEnabled(r.data.enabled)).catch(() => {});
  }, []);

  const home = user?.role === 'admin' ? '/admin' : user?.role === 'driver' ? '/driver' : '/passenger';

  return (
    <div className="navbar">
      <Link className="brand" to={user ? home : '/'}><Logo size={30} dark /></Link>
      <nav>
        {user ? (
          <>
            {user.role === 'passenger' && (
              <>
                <Link to="/passenger">Book a ride</Link>
                <Link to="/passenger/profile">My details</Link>
                <Link to="/passenger/complaints">My complaints</Link>
              </>
            )}
            {user.role === 'driver' && (
              <>
                <Link to="/driver">Trips</Link>
                <Link to="/driver/book">Book for passenger</Link>
                <Link to="/driver/passengers/new">Add passenger</Link>
                <Link to="/driver/schedule">Schedule</Link>
                <Link to="/driver/qr-code">My QR code</Link>
                <Link to="/driver/documents">Documents</Link>
                <Link to="/driver/complaints">Complaints</Link>
                <Link to="/driver/reports">Reports</Link>
                <Link to="/driver/settings">Settings</Link>
                <Link to="/terms">Terms</Link>
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
            <button onClick={() => { logout(); navigate('/'); }}>Log out</button>
          </>
        ) : (
          <>
            <Link to="/about">About</Link>
            <Link to="/login">Log in</Link>
            <Link to="/register">Sign up</Link>
            {driverSignupEnabled && <Link to="/driver-signup">Drive with us</Link>}
          </>
        )}
      </nav>
    </div>
  );
}
