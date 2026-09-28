<script setup>
import { computed, onMounted, ref } from 'vue';
import { showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import Modal from '../../ui/Modal.vue';
import { BADGE, REQUEST_KIND, REQUEST_STATUS, WEEKDAY_SHORT } from '../../utils';

const auth = useAuthStore();
const list = ref([]);
const pendingCount = ref(0);
const loading = ref(true);
const filterStatus = ref('pending');
const filterKind = ref('');

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
    if (filterStatus.value) params.status = filterStatus.value;
    if (filterKind.value) params.kind = filterKind.value;
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
    const path = decision.value === 'approve' ? 'approve' : 'reject';
    const d = await api.put(`/requests/${target.value.id}/${path}`, { note: note.value });
    showToast({
      type: 'success',
      message: decision.value === 'approve'
        ? (d.lesson_id ? '已通过，并生成了课时' : '已通过')
        : '已驳回',
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

function scheduleText(r) {
  const day = r.date ? `${r.date} 周${WEEKDAY_SHORT[new Date(`${r.date}T00:00:00`).getDay()]}` : '';
  const time = r.start_time ? ` ${r.start_time}` : '';
  return `${day}${time}`;
}
</script>

<template>
  <div class="d-page">
    <div class="d-head">
      <div>
        <h1>申请与审批</h1>
        <div class="sub">
          {{ isReviewer ? '审批学生提交的请假与预约申请' : '提交请假 / 预约课程，并查看老师的审批结果' }}
          <template v-if="pendingCount"> · 待处理 {{ pendingCount }} 条</template>
        </div>
      </div>
      <div class="d-head-actions">
        <button v-if="auth.isStudent" class="d-btn primary" @click="$router.push('/availability')">去预约课程</button>
      </div>
    </div>

    <div class="d-toolbar">
      <div class="d-tabs">
        <button
          v-for="s in [{ v: 'pending', t: '待处理' }, { v: 'approved', t: '已通过' }, { v: 'rejected', t: '已驳回' }, { v: '', t: '全部' }]"
          :key="s.v"
          :class="{ on: filterStatus === s.v }"
          @click="filterStatus = s.v; load()"
        >{{ s.t }}</button>
      </div>
      <div class="spacer" />
      <select v-model="filterKind" class="d-select" style="width: 150px" @change="load()">
        <option value="">全部类型</option>
        <option value="leave">请假</option>
        <option value="booking">预约课程</option>
      </select>
    </div>

    <div class="d-card">
      <div v-if="loading" class="d-empty">加载中…</div>
      <div v-else-if="!list.length" class="d-empty">
        <strong>没有符合条件的申请</strong>
        {{ isReviewer ? '学生提交请假或预约后会出现在这里' : '可在「排课」里对某节课提交请假，或在「时段」里预约课程' }}
      </div>
      <div v-else class="d-scroll">
        <table class="d-table">
          <thead>
            <tr>
              <th>类型</th>
              <th>学生</th>
              <th>班级</th>
              <th>时间</th>
              <th>原因</th>
              <th>状态</th>
              <th>提交时间</th>
              <th class="actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in list" :key="r.id">
              <td><span class="d-badge" :class="REQUEST_KIND[r.kind]?.color">{{ REQUEST_KIND[r.kind]?.text }}</span></td>
              <td class="strong">{{ r.student_name }}</td>
              <td>
                <span class="d-dot" :style="{ background: r.class_color, marginRight: '7px' }" />{{ r.class_name }}
              </td>
              <td>{{ scheduleText(r) }}</td>
              <td style="max-width: 220px">{{ r.reason || '—' }}</td>
              <td>
                <span class="d-badge" :class="REQUEST_STATUS[r.status]?.color">{{ REQUEST_STATUS[r.status]?.text }}</span>
                <div v-if="r.decided_note" style="font-size: 12px; color: #98a1b5; margin-top: 3px">
                  {{ r.decided_by_name }}：{{ r.decided_note }}
                </div>
              </td>
              <td style="font-size: 12.5px; color: #98a1b5">{{ r.created_at?.slice(0, 16) }}</td>
              <td class="actions">
                <template v-if="isReviewer && r.status === 'pending'">
                  <button class="d-btn sm primary" @click="openDecide(r, 'approve')">通过</button>
                  <button class="d-btn sm danger" @click="openDecide(r, 'reject')">驳回</button>
                </template>
                <template v-else-if="!isReviewer && r.status === 'pending'">
                  <button class="d-btn sm danger" @click="cancelMine(r)">撤销</button>
                </template>
                <span v-else style="color: #b6bdcc; font-size: 12.5px">{{ r.decided_at?.slice(0, 16) || '—' }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Modal
      v-model:show="showDecide"
      :title="decision === 'approve' ? '通过申请' : '驳回申请'"
      :sub="target ? `${target.student_name} · ${REQUEST_KIND[target.kind]?.text} · ${scheduleText(target)}` : ''"
      size="narrow"
      @update:show="showDecide = $event"
    >
      <div v-if="target" class="d-field" style="margin-bottom: 14px">
        <label>申请原因</label>
        <div style="font-size: 13.5px; color: #4a5470">{{ target.reason || '（学生未填写）' }}</div>
      </div>
      <div v-if="decision === 'approve' && target?.kind === 'booking'" class="d-badge info" style="margin-bottom: 14px">
        通过后将自动在 {{ scheduleText(target) }} 生成一节课
      </div>
      <div v-if="decision === 'approve' && target?.kind === 'leave'" class="d-badge info" style="margin-bottom: 14px">
        通过后该生这节课会直接记为「请假」
      </div>
      <div class="d-field">
        <label>{{ decision === 'approve' ? '给学生的备注（选填）' : '驳回原因（选填）' }}</label>
        <textarea v-model="note" class="d-textarea" style="min-height: 70px" placeholder="会展示给学生" />
      </div>
      <template #footer>
        <button class="d-btn" @click="showDecide = false">取消</button>
        <button class="d-btn" :class="decision === 'approve' ? 'primary' : 'danger'" :disabled="busy" @click="submitDecide">
          {{ decision === 'approve' ? '确认通过' : '确认驳回' }}
        </button>
      </template>
    </Modal>
  </div>
</template>
