<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import { useAuthStore } from '../../store';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const phone = ref('');
const password = ref('');
const loading = ref(false);

async function submit() {
  if (!phone.value || !password.value) return showToast('请填写手机号和密码');
  loading.value = true;
  try {
    await auth.login(phone.value.trim(), password.value);
    showToast({ type: 'success', message: '登录成功' });
    router.replace(String(route.query.redirect || '/'));
  } catch (e) {
    showToast(e.message);
  } finally {
    loading.value = false;
  }
}

const features = [
  { icon: 'calendar-o', title: '排课与课表', sub: '周日历点空档即排，智能排课一次排一整期，还能订阅到手机日历' },
  { icon: 'photograph', title: '签到留痕', sub: '课堂照片 + 手写签名，出勤迟到缺勤请假一键记录' },
  { icon: 'todo-list-o', title: '请假与预约', sub: '学生在线请假与约课，老师审批后自动建课、自动记假' },
  { icon: 'clock-o', title: '智能协调时间', sub: '师生各填可上课时段，系统自动找出双方都合适的空档' },
];
</script>

<template>
  <div class="auth-split">
    <section class="auth-brand">
      <div class="brand-mark small">枢</div>
      <h1>师枢 EduHub</h1>
      <p>为课外班老师打造的轻量教务平台<br />排课 · 签到留痕 · 请假预约 · 课堂记录</p>
      <div class="auth-features">
        <div v-for="f in features" :key="f.title" class="auth-feature">
          <van-icon :name="f.icon" size="17" />
          <div>
            <div>{{ f.title }}</div>
            <div class="auth-feature-sub">{{ f.sub }}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="auth-form">
      <div class="auth-form-inner">
        <h2>欢迎回来</h2>
        <div class="sub">使用手机号登录你的账号</div>
        <form class="d-form" @submit.prevent="submit">
          <div class="d-field">
            <label>手机号</label>
            <input v-model="phone" class="d-input" placeholder="请输入手机号" autocomplete="username" />
          </div>
          <div class="d-field">
            <label>密码</label>
            <input v-model="password" type="password" class="d-input" placeholder="请输入密码" autocomplete="current-password" />
          </div>
          <button class="d-btn primary lg block" type="submit" :disabled="loading">
            {{ loading ? '登录中…' : '登 录' }}
          </button>
        </form>
        <div style="text-align: center; margin-top: 18px; font-size: 13.5px; color: var(--eduhub-muted)">
          还没有账号？
          <router-link to="/register" style="color: var(--van-primary-color)">立即注册</router-link>
        </div>
      </div>
    </section>
  </div>
</template>
