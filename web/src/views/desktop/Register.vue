<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const name = ref('');
const phone = ref('');
const password = ref('');
const role = ref('teacher');
const code = ref(String(route.query.invite || ''));
const loading = ref(false);

async function submit() {
  if (!name.value.trim()) return showToast('请填写姓名');
  if (!/^\d{5,20}$/.test(phone.value.trim())) return showToast('请输入正确的手机号');
  if (password.value.length < 6) return showToast('密码至少 6 位');
  loading.value = true;
  try {
    await auth.register({ name: name.value.trim(), phone: phone.value.trim(), password: password.value, role: role.value });
    // 学生注册时如果填了邀请码，直接帮他加入班级
    if (role.value === 'student' && code.value.trim()) {
      try {
        const d = await api.post('/classes/join', { invite_code: code.value.trim() });
        showToast({ type: 'success', message: `注册成功，已加入「${d.class.name}」` });
      } catch (e) {
        showToast(`注册成功，但加入班级失败：${e.message}`);
      }
    } else {
      showToast({ type: 'success', message: '注册成功' });
    }
    router.replace('/');
  } catch (e) {
    showToast(e.message);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-split">
    <section class="auth-brand">
      <div class="brand-mark small">枢</div>
      <h1>加入师枢</h1>
      <p>老师创建班级并生成邀请码<br />学生凭邀请码加入，即可查看课表、签到与课堂记录</p>
      <div class="auth-features">
        <div class="auth-feature">
          <van-icon name="manager-o" size="17" />
          <div>
            <div>我是老师</div>
            <div class="auth-feature-sub">建班级、排课、签到留痕、写课堂记录、审批请假与预约</div>
          </div>
        </div>
        <div class="auth-feature">
          <van-icon name="friends-o" size="17" />
          <div>
            <div>我是学生</div>
            <div class="auth-feature-sub">凭邀请码加入班级，拍照签名签到，在线请假与约课</div>
          </div>
        </div>
      </div>
    </section>

    <section class="auth-form">
      <div class="auth-form-inner">
        <h2>注册账号</h2>
        <div class="sub">选择身份并填写基本信息</div>

        <div class="role-pick">
          <div class="role-item" :class="{ on: role === 'teacher' }" @click="role = 'teacher'">我是老师</div>
          <div class="role-item" :class="{ on: role === 'student' }" @click="role = 'student'">我是学生</div>
        </div>

        <form class="d-form" @submit.prevent="submit">
          <div class="d-field">
            <label>姓名</label>
            <input v-model="name" class="d-input" placeholder="请输入姓名" />
          </div>
          <div class="d-field">
            <label>手机号</label>
            <input v-model="phone" class="d-input" placeholder="用于登录" autocomplete="username" />
          </div>
          <div class="d-field">
            <label>密码</label>
            <input v-model="password" type="password" class="d-input" placeholder="至少 6 位" autocomplete="new-password" />
          </div>
          <div v-if="role === 'student'" class="d-field">
            <label>班级邀请码（选填）</label>
            <input v-model="code" class="d-input" placeholder="有邀请码可注册后直接加入班级" />
          </div>
          <button class="d-btn primary lg block" type="submit" :disabled="loading">
            {{ loading ? '注册中…' : '注 册' }}
          </button>
        </form>
        <div style="text-align: center; margin-top: 18px; font-size: 13.5px; color: var(--eduhub-muted)">
          已有账号？
          <router-link to="/login" style="color: var(--van-primary-color)">去登录</router-link>
        </div>
      </div>
    </section>
  </div>
</template>
