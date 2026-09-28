<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import { BADGE, endTime, fmtDate, greeting, LESSON_STATUS } from '../../utils';

const router = useRouter();
const auth = useAuthStore();
const dash = ref({ today: '', today_lessons: [], stats: {} });
const loading = ref(true);

onMounted(async () => {
  try {
    dash.value = await api.get('/lessons/dashboard/overview');
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
});

const cards = computed(() => {
  const s = dash.value.stats || {};
  if (auth.isAdmin) {
    return [
      { label: '用户总数', value: s.user_count ?? 0, icon: 'user-o' },
      { label: '教师', value: s.teacher_count ?? 0, icon: 'manager-o' },
      { label: '班级', value: s.class_count ?? 0, icon: 'friends-o' },
      { label: '本周课时', value: s.week_lessons ?? 0, icon: 'calendar-o' },
      { label: '待处理申请', value: s.pending_requests ?? 0, icon: 'todo-list-o', warn: s.pending_requests > 0 },
    ];
  }
  if (auth.canTeach) {
    return [
      { label: '本周课时', value: s.week_lessons ?? 0, icon: 'calendar-o' },
      { label: '班级数量', value: s.class_count ?? 0, icon: 'friends-o' },
      { label: '学生人数', value: s.student_count ?? 0, icon: 'user-o' },
      { label: '本月已完成', value: s.month_done_lessons ?? 0, icon: 'passed' },
      { label: '本月课酬', value: s.month_income ?? 0, icon: 'gold-coin-o', unit: '元' },
      { label: '待处理申请', value: s.pending_requests ?? 0, icon: 'todo-list-o', warn: s.pending_requests > 0 },
    ];
  }
  return [
    { label: '本周课时', value: s.week_lessons ?? 0, icon: 'calendar-o' },
    { label: '已加入班级', value: s.class_count ?? 0, icon: 'friends-o' },
    { label: '待审申请', value: s.my_pending ?? 0, icon: 'todo-list-o' },
  ];
});

function statusOf(l) {
  return LESSON_STATUS[l.status] || LESSON_STATUS.scheduled;
}
</script>

<template>
  <div class="d-page">
    <div class="d-head">
      <div>
        <h1>{{ greeting() }}，{{ auth.user?.name }}</h1>
        <div class="sub">
          {{ fmtDate(new Date()) }} · {{ auth.roleLabel }}
          · 今天 {{ dash.today_lessons.length }} 节课
        </div>
      </div>
      <div class="d-head-actions">
        <button v-if="auth.canTeach" class="d-btn primary" @click="router.push('/schedule')">去排课</button>
        <button class="d-btn" @click="router.push('/requests')">申请与审批</button>
        <button v-if="auth.isAdmin" class="d-btn" @click="router.push('/admin')">管理后台</button>
      </div>
    </div>

    <div :class="cards.length > 4 ? 'd-grid-4' : 'd-grid-3'" style="margin-bottom: 18px">
      <div v-for="c in cards" :key="c.label" class="d-stat">
        <div class="label"><van-icon :name="c.icon" size="15" /> {{ c.label }}</div>
        <div class="value" :style="c.warn ? { color: '#e07a00' } : {}">
          {{ c.value }}<span v-if="c.unit" class="unit">{{ c.unit }}</span>
        </div>
      </div>
    </div>

    <div class="d-card">
      <div class="d-card-title">
        <span>今日课程</span>
        <span class="d-badge mute">共 {{ dash.today_lessons.length }} 节</span>
      </div>
      <div v-if="loading" class="d-empty">加载中…</div>
      <div v-else-if="!dash.today_lessons.length" class="d-empty">
        <strong>今天没有课程安排</strong>
        在「排课」页点击日历空白处即可快速排课
      </div>
      <div v-else class="d-scroll">
        <table class="d-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>班级</th>
              <th>教室</th>
              <th>主题</th>
              <th class="center">签到</th>
              <th>状态</th>
              <th class="actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in dash.today_lessons" :key="l.id">
              <td class="strong">{{ l.start_time }} - {{ endTime(l.start_time, l.duration_min) }}</td>
              <td>
                <span class="d-dot" :style="{ background: l.class_color, marginRight: '7px' }" />{{ l.class_name }}
              </td>
              <td>{{ l.room || '—' }}</td>
              <td>{{ l.topic || '—' }}</td>
              <td class="center">{{ l.checked_count }}/{{ l.student_count }}</td>
              <td><span class="d-badge" :class="BADGE[statusOf(l).color]">{{ statusOf(l).text }}</span></td>
              <td class="actions">
                <button class="d-btn sm" @click="router.push(`/lessons/${l.id}`)">签到与记录</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
