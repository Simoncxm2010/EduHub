import { defineStore } from 'pinia';
import api from './api';
import { syncThemeFromUser } from './composables/theme';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: JSON.parse(localStorage.getItem('eduhub_user') || 'null'),
    token: localStorage.getItem('eduhub_token') || '',
    unread: 0,
  }),
  getters: {
    isTeacher: (s) => s.user?.role === 'teacher',
    isStudent: (s) => s.user?.role === 'student',
    isAdmin: (s) => s.user?.role === 'admin' || s.user?.role === 'super',
    isSuper: (s) => s.user?.role === 'super',
    /** 能否做教学类操作：教师及以上（管理员/超管常也代课） */
    canTeach: (s) => ['teacher', 'admin', 'super'].includes(s.user?.role),
    roleLabel: (s) => ({ student: '学生', teacher: '教师', admin: '管理员', super: '超级管理员' }[s.user?.role] || s.user?.role),
  },
  actions: {
    setAuth(token, user) {
      this.token = token;
      this.user = user;
      localStorage.setItem('eduhub_token', token);
      localStorage.setItem('eduhub_user', JSON.stringify(user));
      // 服务端的主题设置优先（跨设备一致）
      syncThemeFromUser(user);
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
      syncThemeFromUser(d.user);
    },
    async fetchUnread() {
      if (!this.token) return;
      try {
        const d = await api.get('/notifications', { params: { limit: 1 } });
        this.unread = d.unread_count || 0;
      } catch {
        this.unread = 0;
      }
    },
    async markAllRead() {
      try {
        const d = await api.post('/notifications/read', { all: true });
        this.unread = d.unread_count || 0;
      } catch {
        /* 忽略 */
      }
    },
    logout() {
      // 清掉服务端下发的图片鉴权 Cookie（失败也不影响本地登出）
      api.post('/auth/logout').catch(() => {});
      this.token = '';
      this.user = null;
      localStorage.removeItem('eduhub_token');
      localStorage.removeItem('eduhub_user');
    },
  },
});
