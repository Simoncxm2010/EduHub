<script setup>
import { useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import { useAuthStore } from '../store';
import { isDesktop } from '../composables/layout';

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

    <div v-if="isDesktop" class="page-head">
      <div>
        <h1>我的</h1>
        <div class="sub">{{ auth.isTeacher ? '教师账号' : '学生账号' }} · {{ auth.user?.phone }}</div>
      </div>
    </div>

    <div :style="isDesktop ? { maxWidth: '620px' } : {}">
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
        <van-cell
          title="手机端使用"
          :label="isDesktop ? '用手机浏览器打开本平台地址，选择「添加到主屏幕」即可当 App 使用' : '在浏览器菜单中选择「添加到主屏幕」，即可像 App 一样打开'"
        />
        <van-cell title="签到留痕" label="课堂照片与手写签名保存在服务端，仅本班师生可见" />
        <van-cell title="关于师枢" value="EduHub v0.2.0" @click="showToast('师枢 EduHub · 为课外班老师而生')" />
      </div>

      <div style="margin-top: 16px">
        <van-button round block plain type="danger" @click="logout">退出登录</van-button>
      </div>
    </div>
  </div>
</template>
