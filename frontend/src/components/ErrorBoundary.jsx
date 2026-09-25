import { Component } from 'react';

// Without this, any error thrown while rendering unmounts the whole React
// tree and leaves a blank white page - with no address bar to reload from
// when EasyRide is opened from an iPhone home-screen bookmark. Shows a
// way back instead. An error from a stale bundle (a new version was
// deployed while the app sat open in the background) is fixed by a plain
// reload, so that's tried once automatically.
const RELOAD_KEY = 'easyride_error_reload_at';

function isStaleBundleError(error) {
  return /Loading chunk|dynamically imported module|Importing a module script failed|Failed to fetch/i.test(String(error?.message || error));
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
    if (!isStaleBundleError(error)) return;
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY));
      if (last && Date.now() - last < 30000) return; // already tried - don't loop
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch { /* storage unavailable - still worth one reload */ }
    window.location.reload();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="container">
        <div className="card" style={{ maxWidth: 480, margin: '40px auto', textAlign: 'center' }}>
          <h2>Something went wrong</h2>
          <p className="muted">That screen hit an error. Reloading usually fixes it - your bookings are safe.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => window.location.reload()}>Reload</button>
            <button className="btn secondary" onClick={() => { window.location.href = '/'; }}>Go to home</button>
          </div>
        </div>
      </div>
    );
  }
}
