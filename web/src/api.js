import axios from 'axios';
import { showToast } from 'vant';
import router from './router';

const api = axios.create({ baseURL: '/api', timeout: 10000 });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('eduhub_token');
  if (token) cfg.headers.authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const msg = err.response?.data?.message || '网络异常，请稍后再试';
    if (err.response?.status === 401 && router.currentRoute.value.path !== '/login') {
      localStorage.removeItem('eduhub_token');
      localStorage.removeItem('eduhub_user');
      router.replace('/login');
    }
    return Promise.reject(new Error(msg));
  }
);

export function toastError(e) {
  showToast(e?.message || '操作失败');
}

export default api;
