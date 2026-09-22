import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Uploaded files (complaint attachments, driver documents) are served from
// the backend's origin, not under /api - strip that suffix to link to them.
export const fileOrigin = API_URL.replace(/\/api\/?$/, '');

const client = axios.create({
  baseURL: API_URL,
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('easyride_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('easyride_token');
      localStorage.removeItem('easyride_user');
    }
    return Promise.reject(err);
  },
);

export default client;
