<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../store';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const items = [
  { to: '/', icon: 'wap-home-o', text: '首页' },
  { to: '/schedule', icon: 'calendar-o', text: '排课' },
  { to: '/classes', icon: 'friends-o', text: '班级' },
  { to: '/notifications', icon: 'bell', text: '通知', badge: true },
  { to: '/me', icon: 'user-o', text: '我的' },
];

const active = computed({
  get() {
    if (route.path.startsWith('/classes')) return 2;
    if (route.path.startsWith('/requests') || route.path.startsWith('/notifications')) return 3;
    const idx = items.findIndex((i) => i.to === route.path);
    return idx >= 0 ? idx : 0;
  },
  set(v) {
    router.replace(items[v].to);
  },
});

const unreadText = computed(() => (auth.unread > 99 ? '99+' : auth.unread ? String(auth.unread) : ''));
</script>

<template>
  <van-tabbar v-model="active" safe-area-inset-bottom fixed>
    <van-tabbar-item v-for="i in items" :key="i.to" :icon="i.icon" :badge="i.badge ? unreadText : ''">
      {{ i.text }}
    </van-tabbar-item>
  </van-tabbar>
</template>
