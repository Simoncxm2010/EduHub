import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './store';

const routes = [
  { path: '/login', component: () => import('./views/Login.vue'), meta: { public: true } },
  { path: '/register', component: () => import('./views/Register.vue'), meta: { public: true } },
  { path: '/', component: () => import('./views/Dashboard.vue') },
  { path: '/schedule', component: () => import('./views/Schedule.vue') },
  { path: '/classes', component: () => import('./views/Classes.vue') },
  { path: '/classes/:id', component: () => import('./views/ClassDetail.vue') },
  { path: '/lessons/:id', component: () => import('./views/LessonDetail.vue') },
  { path: '/me', component: () => import('./views/Me.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.meta.public) return auth.token ? '/' : true;
  if (!auth.token) return { path: '/login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} };
  if (!auth.user) {
    try {
      await auth.fetchMe();
    } catch {
      auth.logout();
      return '/login';
    }
  }
  return true;
});

export default router;
