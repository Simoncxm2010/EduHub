<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

const items = [
  { to: '/', icon: 'wap-home-o', text: '首页' },
  { to: '/schedule', icon: 'calendar-o', text: '排课' },
  { to: '/classes', icon: 'friends-o', text: '班级' },
  { to: '/me', icon: 'user-o', text: '我的' },
];

const active = computed({
  get() {
    if (route.path.startsWith('/classes')) return 2;
    const idx = items.findIndex((i) => i.to === route.path);
    return idx >= 0 ? idx : 0;
  },
  set(v) {
    router.replace(items[v].to);
  },
});
</script>

<template>
  <van-tabbar v-model="active" safe-area-inset-bottom fixed>
    <van-tabbar-item v-for="i in items" :key="i.to" :icon="i.icon">{{ i.text }}</van-tabbar-item>
  </van-tabbar>
</template>
