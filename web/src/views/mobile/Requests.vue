<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import { cnDate, REQUEST_KIND, REQUEST_STATUS } from '../../utils';

const router = useRouter();
const auth = useAuthStore();
const list = ref([]);
const pendingCount = ref(0);
const loading = ref(true);
const tab = ref('pending');

const showDecide = ref(false);
const target = ref(null);
const decision = ref('approve');
const note = ref('');
const busy = ref(false);

const isReviewer = computed(() => auth.isTeacher || auth.isAdmin);

async function load() {
  loading.value = true;
  try {
    const params = {};
    if (tab.value) params.status = tab.value;
    const d = await api.get('/requests', { params });
    list.value = d.requests;
    pendingCount.value = d.pending_count;
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function openDecide(row, kind) {
  target.value = row;
  decision.value = kind;
  note.value = '';
  showDecide.value = true;
}

async function submitDecide() {
  busy.value = true;
  try {
    const d = await api.put(`/requests/${target.value.id}/${decision.value === 'approve' ? 'approve' : 'reject'}`, { note: note.value });
    showToast({
      type: 'success',
      message: decision.value === 'approve' ? (d.lesson_id ? '已通过并生成课时' : '已通过') : '已驳回',
    });
    showDecide.value = false;
    load();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function cancelMine(row) {
  try {
    await api.delete(`/requests/${row.id}`);
    showToast('已撤销');
    load();
  } catch (e) {
    toastError(e);
  }
}
</script>

<template>
  <div class="page">
    <van-nav-bar title="请假与预约" left-arrow @click-left="router.back()" />

    <van-tabs v-model:active="tab" @change="load">
      <van-tab title="待处理" name="pending" />
      <van-tab title="已通过" name="approved" />
      <van-tab title="已驳回" name="rejected" />
      <van-tab title="全部" name="" />
    </van-tabs>

    <div v-if="!isReviewer" class="card">
      <div style="display: flex; align-items: center; gap: 10px">
        <van-icon name="clock-o" size="20" color="#4f6ef2" />
        <div style="flex: 1">
          <div style="font-size: 14px; font-weight: 500">预约一节课</div>
          <div class="muted">到「时段」页看老师有空的时间并提交预约</div>
        </div>
        <van-button size="small" round type="primary" @click="router.push('/availability')">去预约</van-button>
      </div>
    </div>

    <van-loading v-if="loading" style="margin: 30px auto" vertical>加载中…</van-loading>
    <template v-else>
      <div v-for="r in list" :key="r.id" class="card">
        <div style="display: flex; align-items: center; gap: 8px">
          <van-tag :type="r.kind === 'leave' ? 'warning' : 'primary'" plain>{{ REQUEST_KIND[r.kind]?.text }}</van-tag>
          <span style="font-weight: 600; font-size: 14px">{{ r.student_name }}</span>
          <span class="muted">{{ r.class_name }}</span>
          <div style="flex: 1" />
          <van-tag :type="r.status === 'pending' ? 'warning' : r.status === 'approved' ? 'success' : 'default'">
            {{ REQUEST_STATUS[r.status]?.text }}
          </van-tag>
        </div>
        <div class="muted" style="margin-top: 8px">
          {{ r.date ? cnDate(r.date) : '' }}{{ r.start_time ? ` · ${r.start_time}` : '' }}
        </div>
        <div v-if="r.reason" style="font-size: 13.5px; color: #4a5470; margin-top: 6px">{{ r.reason }}</div>
        <div v-if="r.decided_note" class="muted" style="margin-top: 6px">{{ r.decided_by_name }}：{{ r.decided_note }}</div>

        <div v-if="isReviewer && r.status === 'pending'" style="display: flex; gap: 10px; margin-top: 12px">
          <van-button size="small" round block type="primary" @click="openDecide(r, 'approve')">通过</van-button>
          <van-button size="small" round block plain type="danger" @click="openDecide(r, 'reject')">驳回</van-button>
        </div>
        <div v-else-if="!isReviewer && r.status === 'pending'" style="margin-top: 12px">
          <van-button size="small" round block plain type="danger" @click="cancelMine(r)">撤销申请</van-button>
        </div>
      </div>
      <van-empty v-if="!list.length" image="search" description="暂无申请" />
    </template>

    <van-popup v-model:show="showDecide" round position="bottom" style="padding: 18px 16px 24px">
      <div class="form-title">{{ decision === 'approve' ? '通过申请' : '驳回申请' }}</div>
      <div v-if="target" class="muted" style="text-align: center; margin-bottom: 14px">
        {{ target.student_name }} · {{ REQUEST_KIND[target.kind]?.text }}
      </div>
      <div class="d-badge info" style="display: block; padding: 10px 12px; margin-bottom: 14px">
        {{ decision === 'approve'
          ? (target?.kind === 'booking' ? '通过后会自动生成一节课' : '通过后该生这节课记为「请假」')
          : '驳回后学生会看到你的说明' }}
      </div>
      <van-field v-model="note" type="textarea" rows="2" autosize :label="decision === 'approve' ? '备注' : '原因'" placeholder="选填，会展示给学生" />
      <div style="margin-top: 16px">
        <van-button round block :type="decision === 'approve' ? 'primary' : 'danger'" :loading="busy" @click="submitDecide">
          确认{{ decision === 'approve' ? '通过' : '驳回' }}
        </van-button>
      </div>
    </van-popup>
  </div>
</template>
