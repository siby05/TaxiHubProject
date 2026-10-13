import { create } from 'zustand';
import client from '../api/client';

// Storage can throw (Safari private browsing, storage blocked) - a throw
// here, at import time, would stop the whole app loading (a white screen).
function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* stays signed in for this visit only */ }
}

const storedUser = (() => {
  try {
    return JSON.parse(readStorage('easyride_user'));
  } catch {
    return null;
  }
})();

export const useAuthStore = create((set) => ({
  user: storedUser || null,
  token: readStorage('easyride_token') || null,

  login: async (email, password) => {
    // Safe to retry while a sleeping server boots - logging in twice
    // changes nothing.
    const { data } = await client.post('/auth/login', { email, password }, { wakeRetry: true });
    writeStorage('easyride_token', data.token);
    writeStorage('easyride_user', JSON.stringify(data.user));
    set({ user: data.user, token: data.token });
    return data.user;
  },

  register: async (payload) => {
    const { data } = await client.post('/auth/register', payload);
    writeStorage('easyride_token', data.token);
    writeStorage('easyride_user', JSON.stringify(data.user));
    set({ user: data.user, token: data.token });
    return data.user;
  },

  logout: () => {
    writeStorage('easyride_token', null);
    writeStorage('easyride_user', null);
    set({ user: null, token: null });
  },

  // For flows that get a token/user from a non-/auth endpoint (e.g. driver
  // self-signup) but should still land the user signed in immediately.
  setSession: (token, user) => {
    writeStorage('easyride_token', token);
    writeStorage('easyride_user', JSON.stringify(user));
    set({ user, token });
  },
}));
