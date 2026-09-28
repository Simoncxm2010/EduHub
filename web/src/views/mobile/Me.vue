<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import { mobileMoreLinks } from '../../nav';

const router = useRouter();
const auth = useAuthStore();
const feed = ref(null);
const moreLinks = mobileMoreLinks(auth);

onMounted(async () => {
  try {
    feed.value = await api.get('/calendar/feed-url');
  } catch (e) {
    toastError(e);
  }
});

async function copyFeed() {
  try {
    await navigator.clipboard.writeText(feed.value.url);
    showToast({ type: 'success', message: '订阅地址已复制' });
  } catch {
    showToast('复制失败，请长按选择地址复制');
  }
}

async function exportIcs() {
  try {
    const blob = await api.get('/calendar/export.ics', { responseType: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '师枢课表.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast({ type: 'success', message: '已导出，用手机日历打开即可' });
  } catch (e) {
    toastError(e);
  }
}

async function resetFeed() {
  try {
    await showConfirmDialog({ title: '重置订阅地址', message: '重置后旧地址立即失效，需要重新订阅。', confirmButtonText: '重置' });
  } catch {
    return;
  }
  try {
    await api.post('/calendar/feed-token/reset');
    feed.value = await api.get('/calendar/feed-url');
    showToast('已重置');
  } catch (e) {
    toastError(e);
  }
}

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
      <van-tag :type="auth.isSuper ? 'danger' : auth.isAdmin ? 'warning' : auth.isTeacher ? 'primary' : 'success'" size="large">
        {{ auth.roleLabel }}
      </van-tag>
    </div>

    <div class="card card-tight">
      <div v-for="l in moreLinks" :key="l.to" class="attend-row" style="cursor: pointer" @click="router.push(l.to)">
        <div class="attend-name">
          <van-icon :name="l.icon" size="19" color="#4f6ef2" />
          <div>
            <div style="font-weight: 500; font-size: 14px">{{ l.text }}</div>
            <div class="muted">{{ l.desc }}</div>
          </div>
        </div>
        <van-icon name="arrow" color="#c3c9d6" />
      </div>
    </div>

    <div class="card">
      <div style="display: flex; align-items: center; gap: 8px">
        <van-icon name="calendar-o" size="19" color="#4f6ef2" />
        <span style="font-size: 15px; font-weight: 600">订阅到手机日历</span>
      </div>
      <div class="muted" style="margin-top: 8px; line-height: 1.7">
        设置 → 日历 → 添加已订阅的日历，把下面的地址粘进去。课表变动会自动同步，上课前 30 分钟提醒。
      </div>
      <div style="margin-top: 12px; background: #f6f8fd; border-radius: 10px; padding: 12px; word-break: break-all; font-size: 12.5px; color: #3d5ecc">
        {{ feed?.webcal || '生成中…' }}
      </div>
      <div style="display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap">
        <van-button size="small" round type="primary" @click="copyFeed">复制地址</van-button>
        <van-button size="small" round plain @click="exportIcs">导出 .ics</van-button>
        <van-button size="small" round plain type="danger" @click="resetFeed">重置</van-button>
      </div>
      <div class="muted" style="margin-top: 10px">订阅地址含专属令牌，请勿分享；泄露可点「重置」。</div>
    </div>

    <div class="card" style="padding: 0">
      <van-cell
        title="我的身份"
        :value="auth.isAdmin ? '管理员 · 可管理用户与权限' : auth.isTeacher ? '教师 · 可排课与签到管理' : '学生 · 查看课程与记录'"
      />
      <van-cell title="签到留痕" label="课堂照片与手写签名保存在服务端，仅本班师生可见" />
      <van-cell title="手机端使用" label="在浏览器菜单选择「添加到主屏幕」，即可像 App 一样打开" />
      <van-cell title="关于师枢" value="EduHub v0.4.0" @click="showToast('师枢 EduHub · 为课外班老师而生')" />
    </div>

    <div style="margin-top: 16px">
      <van-button round block plain type="danger" @click="logout">退出登录</van-button>
    </div>
  </div>
</template>
