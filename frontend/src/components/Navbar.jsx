import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useDriverSignupEnabled } from '../hooks/useDriverSignupEnabled';
import NotificationBell from './NotificationBell';
import Logo from './Logo';

const ROLE_LINKS = {
  passenger: [
    { to: '/passenger', label: 'Book a ride' },
    { to: '/passenger/profile', label: 'My details' },
    { to: '/passenger/complaints', label: 'My complaints' },
  ],
  driver: [
    { to: '/driver', label: 'Trips' },
    { to: '/driver/book', label: 'Book for passenger' },
    { to: '/driver/passengers/new', label: 'Add passenger' },
    { to: '/driver/schedule', label: 'Schedule' },
    { to: '/driver/qr-code', label: 'My QR code' },
    { to: '/driver/documents', label: 'Documents' },
    { to: '/driver/complaints', label: 'Complaints' },
    { to: '/driver/reports', label: 'Reports' },
    { to: '/driver/settings', label: 'Settings' },
    { to: '/terms', label: 'Terms' },
  ],
  admin: [
    { to: '/admin', label: 'Dashboard' },
    { to: '/admin/complaints', label: 'Complaints' },
  ],
};

// Signed-in users (passenger/driver/admin) always get a hamburger menu that
// opens a side drawer - the driver alone has ten links, which never fit a
// top bar on anything smaller than a wide laptop. Signed-out visitors keep
// inline links on wide screens (good for the public site and its SEO) and
// get the same drawer on phones.
export default function Navbar() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const driverSignupEnabled = useDriverSignupEnabled();
  const [open, setOpen] = useState(false);

  const home = user?.role === 'admin' ? '/admin' : user?.role === 'driver' ? '/driver' : '/passenger';

  const links = user
    ? ROLE_LINKS[user.role] || []
    : [
      { to: '/airport-transfers', label: 'Airport transfers' },
      { to: '/about', label: 'About' },
      { to: '/login', label: 'Log in' },
      { to: '/register', label: 'Sign up' },
      ...(driverSignupEnabled ? [{ to: '/driver-signup', label: 'Drive with us' }] : []),
    ];

  // Close on navigation, and on Escape; lock page scroll behind the drawer.
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  function doLogout() {
    setOpen(false);
    logout();
    navigate('/');
  }

  // `end` so e.g. "Trips" (/driver) isn't highlighted on every /driver/* page.
  const linkList = links.map((l) => (
    <NavLink key={l.to} to={l.to} end>{l.label}</NavLink>
  ));

  return (
    <header className={`navbar${user ? ' signed-in' : ''}`}>
      <Link className="brand" to={user ? home : '/'}><Logo size={30} dark /></Link>

      {!user && <nav className="navbar-inline" aria-label="Main">{linkList}</nav>}

      <div className="navbar-actions">
        {user && <NotificationBell />}
        <button
          type="button"
          className="navbar-burger"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="nav-drawer"
          onClick={() => setOpen((o) => !o)}
        >
          <span /><span /><span />
        </button>
      </div>

      <div className={`nav-backdrop${open ? ' open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside id="nav-drawer" className={`nav-drawer${open ? ' open' : ''}`} aria-hidden={!open} inert={open ? undefined : ''}>
        <div className="nav-drawer-head">
          {user ? (
            <div>
              <div className="nav-drawer-name">{user.name}</div>
              <div className="nav-drawer-role">{user.role}</div>
            </div>
          ) : <Logo size={26} dark />}
          <button type="button" className="nav-drawer-close" aria-label="Close menu" onClick={() => setOpen(false)}>×</button>
        </div>
        <nav aria-label="Menu">{linkList}</nav>
        {user && <button type="button" className="nav-drawer-logout" onClick={doLogout}>Log out</button>}
      </aside>
    </header>
  );
}
