import { useEffect, useRef, useState } from 'react';
import client from '../api/client';

// "Sign in with Google" via Google Identity Services (free). Renders
// nothing unless VITE_GOOGLE_CLIENT_ID is set. Google's script is loaded
// only when this button mounts (login/sign-up pages), never on the home
// page. The ID token it returns is verified by the backend (POST
// /api/auth/google), which replies with our own session token.

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();

let scriptPromise = null;
function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { scriptPromise = null; reject(new Error('Could not load Google sign-in')); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

// onSignedIn(token, user) is called after the backend accepts the sign-in.
export default function GoogleSignInButton({ onSignedIn, text = 'continue_with' }) {
  const boxRef = useRef(null);
  const handlerRef = useRef(onSignedIn);
  handlerRef.current = onSignedIn;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!CLIENT_ID) return undefined;
    let alive = true;
    loadGoogleScript()
      .then(() => {
        if (!alive || !boxRef.current) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: async ({ credential }) => {
            if (!alive) return;
            setError('');
            setBusy(true);
            try {
              const { data } = await client.post('/auth/google', { credential });
              if (alive) handlerRef.current(data.token, data.user);
            } catch (err) {
              if (alive) setError(err.response?.data?.error || 'Google sign-in failed - please try again');
            } finally {
              if (alive) setBusy(false);
            }
          },
        });
        window.google.accounts.id.renderButton(boxRef.current, {
          theme: 'outline',
          size: 'large',
          text,
          shape: 'pill',
          width: Math.min(400, Math.max(200, boxRef.current.offsetWidth || 320)),
        });
      })
      .catch(() => { if (alive) setError('Google sign-in is unavailable right now - use email and password'); });
    return () => { alive = false; };
  }, [text]);

  if (!CLIENT_ID) return null;

  return (
    <div style={{ margin: '4px 0 12px' }}>
      <div ref={boxRef} style={{ display: 'flex', justifyContent: 'center', minHeight: 44, opacity: busy ? 0.5 : 1 }} />
      {busy && <p className="muted" style={{ textAlign: 'center', margin: '6px 0 0' }}>Signing you in...</p>}
      {error && <p className="error-text" style={{ textAlign: 'center' }}>{error}</p>}
      <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 0', fontSize: '0.85rem' }}>
        <span style={{ flex: 1, height: 1, background: 'currentColor', opacity: 0.25 }} />
        or with email
        <span style={{ flex: 1, height: 1, background: 'currentColor', opacity: 0.25 }} />
      </div>
    </div>
  );
}
