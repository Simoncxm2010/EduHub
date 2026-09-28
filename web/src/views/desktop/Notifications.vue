<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';

const router = useRouter();
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

async function open(n) {
  if (!n.read) {
    try {
      const d = await api.post('/notifications/read', { ids: [n.id] });
      n.read = 1;
      auth.unread = d.unread_count;
    } catch {
      /* 忽略 */
    }
  }
  if (n.link) router.push(n.link);
}

async function readAll() {
  await auth.markAllRead();
  list.value.forEach((n) => { n.read = 1; });
}

async function clearAll() {
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
  <div class="d-page">
    <div class="d-head">
      <div>
        <h1>通知</h1>
        <div class="sub">申请提交、审批结果都会出现在这里</div>
      </div>
      <div class="d-head-actions">
        <button v-if="list.length" class="d-btn" :disabled="!auth.unread" @click="readAll">全部已读</button>
        <button v-if="list.length" class="d-btn danger" @click="clearAll">清空</button>
      </div>
    </div>

    <div class="d-card">
      <div v-if="loading" class="d-empty">加载中…</div>
      <div v-else-if="!list.length" class="d-empty"><strong>暂无通知</strong>审批结果、新申请都会推送到这里</div>
      <div v-else class="d-rows">
        <div
          v-for="n in list"
          :key="n.id"
          class="d-row notif-row"
          :class="{ unread: !n.read }"
          style="cursor: pointer"
          @click="open(n)"
        >
          <span v-if="!n.read" class="unread-dot" />
          <div class="grow">
            <div class="title">{{ n.title }}</div>
            <div v-if="n.body" class="meta" style="color: #4a5470; font-size: 13px">{{ n.body }}</div>
          </div>
          <span class="d-badge mute">{{ n.created_at?.slice(5, 16) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notif-row.unread { background: #f7f9ff; border-radius: 10px; padding-left: 10px; padding-right: 10px; }
.unread-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--van-primary-color); flex: none; }
</style>
