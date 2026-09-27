<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import { useAuthStore } from '../store';

const router = useRouter();
const auth = useAuthStore();

const name = ref('');
const phone = ref('');
const password = ref('');
const role = ref('teacher');
const loading = ref(false);

async function submit() {
  if (!name.value.trim()) return showToast('请填写姓名');
  if (!/^\d{5,20}$/.test(phone.value.trim())) return showToast('请输入正确的手机号');
  if (password.value.length < 6) return showToast('密码至少 6 位');
  loading.value = true;
  try {
    await auth.register({ name: name.value.trim(), phone: phone.value.trim(), password: password.value, role: role.value });
    showToast({ type: 'success', message: '注册成功' });
    router.replace('/');
  } catch (e) {
    showToast(e.message);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="page-plain login-page">
    <van-nav-bar title="注册账号" left-arrow @click-left="router.back()" />

    <div class="card">
      <div class="form-title">选择身份</div>
      <div class="role-pick">
        <div class="role-item" :class="{ on: role === 'teacher' }" @click="role = 'teacher'">我是老师</div>
        <div class="role-item" :class="{ on: role === 'student' }" @click="role = 'student'">我是学生</div>
      </div>

      <van-form @submit="submit">
        <van-cell-group inset>
          <van-field v-model="name" label="姓名" placeholder="请输入姓名" clearable />
          <van-field v-model="phone" label="手机号" placeholder="用于登录" clearable />
          <van-field v-model="password" label="密码" type="password" placeholder="至少 6 位" />
        </van-cell-group>
        <div v-if="role === 'student'" class="muted" style="margin: 10px 20px 0">
          注册后可在「班级」页输入老师提供的邀请码加入班级。
        </div>
        <div style="margin: 16px">
          <van-button round block type="primary" native-type="submit" :loading="loading">注 册</van-button>
          <div class="muted" style="text-align: center; margin-top: 14px">
            已有账号？
            <router-link to="/login" style="color: var(--van-primary-color)">去登录</router-link>
          </div>
        </div>
      </van-form>
    </div>
  </div>
</template>

<style scoped>
.login-page { min-height: 100vh; }
</style>
