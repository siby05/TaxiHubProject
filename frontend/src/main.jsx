import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { wakeServer } from './api/client';
import './index.css';

// Required for Chrome/Android to consider the app installable (see
// public/sw.js) - registered once, on load, regardless of route or role.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// iOS home-screen web apps: when the app comes back from the background
// after iOS has discarded its page, it can be restored as an empty white
// screen with no address bar to reload from. If the page is shown again
// and React's root is somehow empty, reload it.
window.addEventListener('pageshow', (e) => {
  if (e.persisted && !document.getElementById('root')?.hasChildNodes()) window.location.reload();
});

// Start a sleeping backend booting as early as possible (see api/client.js).
wakeServer();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
