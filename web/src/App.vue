<script setup>
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import { useAuthStore } from './store';
import { isDesktop } from './composables/layout';
import { buildNav } from './nav';
import TabBar from './components/TabBar.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const isPublic = computed(() => !!route.meta.public);
/** 桌面端且已登录的非公开页才套用侧边导航外壳 */
const useShell = computed(() => isDesktop.value && !isPublic.value && !!auth.token);

const navItems = computed(() => buildNav(auth));

const activePath = computed(() => {
  if (route.path.startsWith('/classes')) return '/classes';
  if (route.path.startsWith('/lessons')) return '/schedule';
  return route.path;
});

// 登录后拉一次未读数，路由切换时刷新（含审批动作后的回跳）
watch(
  () => [auth.token, route.path],
  ([token]) => {
    if (token && !isPublic.value) auth.fetchUnread();
  },
  { immediate: true }
);

async function logout() {
  try {
    await showConfirmDialog({ title: '退出登录', message: '确定退出当前账号吗？' });
  } catch {
    return;
  }
  auth.logout();
  showToast('已退出');
  router.replace('/login');
}
</script>

<template>
  <div class="shell" :class="isDesktop ? 'shell-desktop' : 'shell-mobile'">
    <aside v-if="useShell" class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-mark small">枢</div>
        <div class="sidebar-brand-text">
          <div class="sidebar-title">师枢 EduHub</div>
          <div class="sidebar-sub">排课 · 签到 · 请假预约</div>
        </div>
      </div>

      <nav class="sidebar-nav">
        <RouterLink
          v-for="n in navItems"
          :key="n.to"
          :to="n.to"
          class="sidebar-item"
          :class="{ on: activePath === n.to }"
        >
          <van-icon :name="n.icon" size="19" />
          <span class="sidebar-item-text">
            <span class="sidebar-item-title">{{ n.text }}</span>
            <span class="sidebar-item-desc">{{ n.desc }}</span>
          </span>
          <span v-if="n.to === '/notifications' && auth.unread" class="sidebar-badge">{{ auth.unread > 99 ? '99+' : auth.unread }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-foot">
        <div class="sidebar-user">
          <div class="avatar">{{ (auth.user?.name || '?').slice(0, 1) }}</div>
          <div class="sidebar-user-text">
            <div class="sidebar-user-name">{{ auth.user?.name }}</div>
            <div class="sidebar-user-role">{{ auth.roleLabel }} · {{ auth.user?.phone }}</div>
          </div>
        </div>
        <van-button size="small" round plain block icon="revoke" @click="logout">退出登录</van-button>
      </div>
    </aside>

    <main class="shell-main">
      <router-view />
    </main>

    <TabBar v-if="!useShell && !isPublic && !!auth.token" />
  </div>
</template>
