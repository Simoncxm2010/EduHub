<script setup>
import { useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import { useAuthStore } from '../store';
import TabBar from '../components/TabBar.vue';

const router = useRouter();
const auth = useAuthStore();

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
  <div class="page">
    <van-nav-bar title="我的" />

    <div class="card" style="display: flex; align-items: center; gap: 14px">
      <div class="class-chip" style="background: linear-gradient(135deg, #4f6ef2, #7b93ff)">
        {{ (auth.user?.name || '?').slice(0, 1) }}
      </div>
      <div style="flex: 1">
        <div class="class-name">{{ auth.user?.name }}</div>
        <div class="muted" style="margin-top: 4px">{{ auth.user?.phone }}</div>
      </div>
      <van-tag :type="auth.isTeacher ? 'primary' : 'success'" size="large">
        {{ auth.isTeacher ? '老师' : '学生' }}
      </van-tag>
    </div>

    <div class="card" style="padding: 0">
      <van-cell title="我的身份" :value="auth.isTeacher ? '教师 · 可排课与签到管理' : '学生 · 查看课程与记录'" />
      <van-cell title="手机端使用" label="在浏览器菜单中选择「添加到主屏幕」，即可像 App 一样打开" />
      <van-cell title="关于师枢" value="EduHub v0.1.0" @click="showToast('师枢 EduHub · 为课外班老师而生')" />
    </div>

    <div style="margin-top: 16px">
      <van-button round block plain type="danger" @click="logout">退出登录</van-button>
    </div>

    <TabBar />
  </div>
</template>
