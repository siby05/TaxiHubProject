import { create } from 'zustand';
import client from '../api/client';

const storedUser = (() => {
  try {
    return JSON.parse(localStorage.getItem('easyride_user'));
  } catch {
    return null;
  }
})();

export const useAuthStore = create((set) => ({
  user: storedUser || null,
  token: localStorage.getItem('easyride_token') || null,

  login: async (email, password) => {
    const { data } = await client.post('/auth/login', { email, password });
    localStorage.setItem('easyride_token', data.token);
    localStorage.setItem('easyride_user', JSON.stringify(data.user));
    set({ user: data.user, token: data.token });
    return data.user;
  },

  register: async (payload) => {
    const { data } = await client.post('/auth/register', payload);
    localStorage.setItem('easyride_token', data.token);
    localStorage.setItem('easyride_user', JSON.stringify(data.user));
    set({ user: data.user, token: data.token });
    return data.user;
  },

  logout: () => {
    localStorage.removeItem('easyride_token');
    localStorage.removeItem('easyride_user');
    set({ user: null, token: null });
  },

  // For flows that get a token/user from a non-/auth endpoint (e.g. driver
  // self-signup) but should still land the user signed in immediately.
  setSession: (token, user) => {
    localStorage.setItem('easyride_token', token);
    localStorage.setItem('easyride_user', JSON.stringify(user));
    set({ user, token });
  },
}));
