<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import { useBack } from '../../composables/back';

const router = useRouter();
const back = useBack('/');
const auth = useAuthStore();
const list = ref([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    const d = await api.get('/notifications');
    list.value = d.notifications;
    auth.unread = d.unread_count;
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function open(n) {
  if (!n.read) markRead(n);
  if (n.link) router.push(n.link);
}

async function markRead(n) {
  try {
    const d = await api.post('/notifications/read', { ids: [n.id] });
    n.read = 1;
    auth.unread = d.unread_count;
  } catch {
    /* 忽略 */
  }
}

async function readAll() {
  await auth.markAllRead();
  list.value.forEach((n) => { n.read = 1; });
  showToast('已全部标记为已读');
}

async function clearAll() {
  try {
    await showConfirmDialog({ title: '清空通知', message: '确定清空全部通知吗？' });
  } catch {
    return;
  }
  try {
    await api.delete('/notifications');
    list.value = [];
    auth.unread = 0;
  } catch (e) {
    toastError(e);
  }
}
</script>

<template>
  <div class="page">
    <van-nav-bar title="通知" left-arrow @click-left="back()">
      <template #right>
        <span v-if="list.length" style="color: var(--van-primary-color)" @click="readAll">全部已读</span>
      </template>
    </van-nav-bar>

    <van-loading v-if="loading" style="margin: 30px auto" vertical>加载中…</van-loading>
    <template v-else>
      <div v-for="n in list" :key="n.id" class="card notif" :class="{ unread: !n.read }" @click="open(n)">
        <div style="display: flex; align-items: center; gap: 8px">
          <span v-if="!n.read" class="unread-dot" />
          <span style="font-size: 14.5px; font-weight: 600; flex: 1">{{ n.title }}</span>
          <span class="muted">{{ n.created_at?.slice(5, 16) }}</span>
        </div>
        <div v-if="n.body" style="font-size: 13.5px; color: #4a5470; margin-top: 6px; line-height: 1.65">{{ n.body }}</div>
      </div>
      <van-empty v-if="!list.length" image="clean" description="暂无通知" />
      <div v-if="list.length" style="margin-top: 16px">
        <van-button round block plain type="danger" @click="clearAll">清空通知</van-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.notif { cursor: pointer; }
.notif.unread { border-left: 3px solid var(--van-primary-color); }
.unread-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--van-primary-color); flex: none; }
</style>
