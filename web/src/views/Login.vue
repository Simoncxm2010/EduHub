<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import { useAuthStore } from '../store';
import { isDesktop } from '../composables/layout';

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
  { icon: 'calendar-o', title: '排课与课表', sub: '按周重复建课，桌面端周日历一览，手机端随时查课' },
  { icon: 'photograph', title: '签到留痕', sub: '课堂照片 + 手写签名，出勤迟到缺勤请假一键记录' },
  { icon: 'records', title: '课堂记录', sub: '授课内容与作业沉淀下来，学生端随时回看' },
];
</script>

<template>
  <div :class="isDesktop ? 'auth-split' : 'auth-page'">
    <section v-if="isDesktop" class="auth-brand">
      <div class="brand-mark small">枢</div>
      <h1>师枢 EduHub</h1>
      <p>为课外班老师打造的轻量教务平台<br />排课 · 签到 · 课堂记录，网页与手机通用</p>
      <div class="auth-features">
        <div v-for="f in features" :key="f.title" class="auth-feature">
          <van-icon :name="f.icon" size="18" />
          <div>
            <div>{{ f.title }}</div>
            <div class="auth-feature-sub">{{ f.sub }}</div>
          </div>
        </div>
      </div>
    </section>

    <section :class="isDesktop ? 'auth-form' : 'page-plain auth-page'">
      <div :class="isDesktop ? 'auth-form-inner' : ''">
        <template v-if="!isDesktop">
          <div class="auth-brand-mobile">
            <div class="brand-mark">枢</div>
            <h1>师枢 EduHub</h1>
            <p class="muted">课外班排课 · 签到 · 课堂记录</p>
          </div>
        </template>
        <template v-else>
          <h2>欢迎回来</h2>
          <div class="sub">使用手机号登录你的账号</div>
        </template>

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
    </section>
  </div>
</template>
