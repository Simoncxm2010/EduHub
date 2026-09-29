<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import api from '../../api';
import { useAuthStore } from '../../store';
import { isDesktop } from '../../composables/layout';
import { useBack } from '../../composables/back';

const router = useRouter();
const route = useRoute();
const back = useBack('/login');
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
    // 带了邀请码就注册后直接进班
    let joined = '';
    if (role.value === 'student' && code.value.trim()) {
      try {
        const d = await api.post('/classes/join', { invite_code: code.value.trim() });
        joined = `，已加入「${d.class.name}」`;
      } catch (e) {
        showToast(`注册成功，但加入班级失败：${e.message}`);
      }
    }
    showToast({ type: 'success', message: `注册成功${joined}` });
    router.replace('/');
  } catch (e) {
    showToast(e.message);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div :class="isDesktop ? 'auth-split' : 'auth-page'">
    <section v-if="isDesktop" class="auth-brand">
      <div class="brand-mark small">枢</div>
      <h1>加入师枢</h1>
      <p>老师创建班级并生成邀请码<br />学生注册后凭邀请码加入，即可查看课表与课堂记录</p>
      <div class="auth-features">
        <div class="auth-feature">
          <van-icon name="manager-o" size="18" />
          <div>
            <div>我是老师</div>
            <div class="auth-feature-sub">建班级、排课、签到、写课堂记录</div>
          </div>
        </div>
        <div class="auth-feature">
          <van-icon name="friends-o" size="18" />
          <div>
            <div>我是学生</div>
            <div class="auth-feature-sub">凭邀请码加入班级，拍照签名签到</div>
          </div>
        </div>
      </div>
    </section>

    <section :class="isDesktop ? 'auth-form' : 'page-plain auth-page'">
      <div :class="isDesktop ? 'auth-form-inner' : ''">
        <template v-if="!isDesktop">
          <van-nav-bar title="注册账号" left-arrow @click-left="back()" />
        </template>
        <template v-else>
          <h2>注册账号</h2>
          <div class="sub">选择身份，填写基本信息即可开始使用</div>
        </template>

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
          <van-field v-if="role === 'student'" v-model="code" label="邀请码" placeholder="老师给你的 6 位邀请码（选填）" clearable />
            </van-cell-group>
            <div v-if="role === 'student'" class="muted" style="margin: 10px 20px 0">
              填写邀请码可在注册后自动加入班级；也可以之后再在「班级」页输入。
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
    </section>
  </div>
</template>
