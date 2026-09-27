import { defineStore } from 'pinia';
import api from './api';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: JSON.parse(localStorage.getItem('eduhub_user') || 'null'),
    token: localStorage.getItem('eduhub_token') || '',
  }),
  getters: {
    isTeacher: (s) => s.user?.role === 'teacher',
  },
  actions: {
    setAuth(token, user) {
      this.token = token;
      this.user = user;
      localStorage.setItem('eduhub_token', token);
      localStorage.setItem('eduhub_user', JSON.stringify(user));
    },
    async login(phone, password) {
      const d = await api.post('/auth/login', { phone, password });
      this.setAuth(d.token, d.user);
    },
    async register(payload) {
      const d = await api.post('/auth/register', payload);
      this.setAuth(d.token, d.user);
    },
    async fetchMe() {
      const d = await api.get('/auth/me');
      this.user = d.user;
      localStorage.setItem('eduhub_user', JSON.stringify(d.user));
    },
    logout() {
      this.token = '';
      this.user = null;
      localStorage.removeItem('eduhub_token');
      localStorage.removeItem('eduhub_user');
    },
  },
});
