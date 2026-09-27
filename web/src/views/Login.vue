<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import { useAuthStore } from '../store';

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
</script>

<template>
  <div class="page-plain login-page">
    <div class="login-head">
      <div class="brand-mark">枢</div>
      <h1 class="login-title">师枢 EduHub</h1>
      <p class="muted">课外班排课 · 签到 · 课堂记录</p>
    </div>

    <div class="card">
      <van-form @submit="submit">
        <van-cell-group inset>
          <van-field v-model="phone" label="手机号" placeholder="请输入手机号" clearable />
          <van-field v-model="password" label="密码" type="password" placeholder="请输入密码" />
        </van-cell-group>
        <div style="margin: 16px">
          <van-button round block type="primary" native-type="submit" :loading="loading">登 录</van-button>
          <div class="muted" style="text-align: center; margin-top: 14px">
            还没有账号？
            <router-link to="/register" style="color: var(--van-primary-color)">立即注册</router-link>
          </div>
        </div>
      </van-form>
    </div>
  </div>
</template>

<style scoped>
.login-page { min-height: 100vh; }
.login-head { text-align: center; padding: 64px 0 26px; }
.login-title { font-size: 24px; margin: 16px 0 6px; }
</style>
