<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import { useAuthStore } from './store';
import { isDesktop } from './composables/layout';
import TabBar from './components/TabBar.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const isPublic = computed(() => !!route.meta.public);
/** 桌面端且已登录的非公开页才套用侧边导航外壳 */
const useShell = computed(() => isDesktop.value && !isPublic.value && !!auth.token);
const navItems = [
  { to: '/', icon: 'wap-home-o', text: '首页', desc: '今日课程与统计' },
  { to: '/schedule', icon: 'calendar-o', text: '排课', desc: '周课表与新建课程' },
  { to: '/classes', icon: 'friends-o', text: '班级', desc: '班级与学生名单' },
  { to: '/me', icon: 'user-o', text: '我的', desc: '账号与设置' },
];

const activePath = computed(() => {
  if (route.path.startsWith('/classes')) return '/classes';
  if (route.path.startsWith('/lessons')) return '/schedule';
  return route.path;
});

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
          <div class="sidebar-sub">排课 · 签到 · 课堂记录</div>
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
        </RouterLink>
      </nav>

      <div class="sidebar-foot">
        <div class="sidebar-user">
          <div class="avatar">{{ (auth.user?.name || '?').slice(0, 1) }}</div>
          <div class="sidebar-user-text">
            <div class="sidebar-user-name">{{ auth.user?.name }}</div>
            <div class="sidebar-user-role">{{ auth.isTeacher ? '教师' : '学生' }} · {{ auth.user?.phone }}</div>
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
