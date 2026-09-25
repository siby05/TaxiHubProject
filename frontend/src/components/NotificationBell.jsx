import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useSocket } from '../hooks/useSocket';

export default function NotificationBell() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const navigate = useNavigate();

  function load() {
    client.get('/notifications').then((r) => setItems(r.data)).catch(() => {});
  }

  useEffect(() => { load(); }, []);

  useSocket({
    'notification:new': (n) => setItems((list) => [n, ...list]),
  });

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const unread = items.filter((n) => !n.read).length;

  async function markAllRead() {
    await client.put('/notifications/read-all');
    setItems((list) => list.map((n) => ({ ...n, read: true })));
  }

  async function openNotification(n) {
    if (!n.read) {
      await client.put(`/notifications/${n._id}/read`);
      setItems((list) => list.map((x) => (x._id === n._id ? { ...x, read: true } : x)));
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  return (
    <div style={{ position: 'relative' }} ref={wrapRef}>
      <button onClick={() => setOpen((o) => !o)} style={{ position: 'relative' }} aria-label="Notifications">
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -6, background: '#dc2626', color: 'white',
            borderRadius: 999, fontSize: '0.65rem', padding: '1px 5px', minWidth: 16, textAlign: 'center',
          }}
          >
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="autocomplete-list notification-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px' }}>
            <strong style={{ color: 'var(--text)' }}>Notifications</strong>
            {unread > 0 && <button className="btn secondary" style={{ padding: '2px 8px', fontSize: '0.75rem' }} onClick={markAllRead}>Mark all read</button>}
          </div>
          {items.length === 0 && <div className="autocomplete-item muted">Nothing yet</div>}
          {items.map((n) => (
            <div key={n._id} className="autocomplete-item" style={{ background: n.read ? undefined : '#fff7ed' }} onClick={() => openNotification(n)}>
              <div style={{ color: 'var(--text)', fontWeight: 600 }}>{n.title}</div>
              <div className="muted">{n.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
