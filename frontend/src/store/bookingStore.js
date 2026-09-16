import { create } from 'zustand';
import client from '../api/client';

export const useBookingStore = create((set, get) => ({
  bookings: [],
  loading: false,

  fetchMine: async () => {
    set({ loading: true });
    const { data } = await client.get('/booking/mine');
    set({ bookings: data, loading: false });
    return data;
  },

  fetchDriverBookings: async (params) => {
    set({ loading: true });
    const { data } = await client.get('/booking/driver', { params });
    set({ bookings: data, loading: false });
    return data;
  },

  createBooking: async (payload) => {
    const { data } = await client.post('/booking', payload);
    set({ bookings: [data, ...get().bookings] });
    return data;
  },
}));
