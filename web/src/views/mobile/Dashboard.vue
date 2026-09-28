<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import { isDesktop } from '../../composables/layout';
import { cnDate, fmtDate, greeting } from '../../utils';
import LessonCard from '../../components/LessonCard.vue';

const router = useRouter();
const auth = useAuthStore();
const dash = ref({ today: '', today_lessons: [], stats: {} });

onMounted(async () => {
  try {
    dash.value = await api.get('/lessons/dashboard/overview');
  } catch (e) {
    toastError(e);
  }
});

const s = computed(() => dash.value.stats || {});
const statItems = computed(() => {
  if (auth.isAdmin) {
    return [
      { label: '本周课时', value: s.value.week_lessons ?? 0 },
      { label: '班级数量', value: s.value.class_count ?? 0 },
      { label: '待处理申请', value: s.value.pending_requests ?? 0 },
    ];
  }
  if (auth.canTeach) {
    return [
      { label: '本周课时', value: s.value.week_lessons ?? 0 },
      { label: '学生人数', value: s.value.student_count ?? 0 },
      { label: '本月课酬', value: `${s.value.month_income ?? 0} 元` },
      { label: '待处理申请', value: s.value.pending_requests ?? 0, warn: (s.value.pending_requests ?? 0) > 0 },
    ];
  }
  return [
    { label: '本周课时', value: s.value.week_lessons ?? 0 },
    { label: '已加入班级', value: s.value.class_count ?? 0 },
    { label: '待审申请', value: s.value.my_pending ?? 0 },
  ];
});
</script>

<template>
  <div class="page">
    <!-- 移动端：渐变头图 -->
    <template v-if="!isDesktop">
      <header class="hero">
        <div class="hero-greeting">{{ greeting() }}，{{ auth.user?.name }}</div>
        <div class="hero-sub">
          {{ cnDate(dash.today) }} · 本周 {{ s.week_lessons ?? 0 }} 节课
          <template v-if="auth.canTeach"> · 已完成 {{ s.month_done_lessons ?? 0 }} 节</template>
        </div>
      </header>

      <div class="card stats hero-overlap">
        <div style="display: flex; text-align: center">
          <div v-for="i in statItems" :key="i.label" style="flex: 1">
            <div class="stat-num" :style="i.warn ? { color: '#e07a00' } : {}">{{ i.value }}</div>
            <div class="stat-label">{{ i.label }}</div>
          </div>
        </div>
      </div>

      <!-- 待办提醒：点击直达 -->
      <div
        v-if="(auth.canTeach && s.pending_requests) || (!auth.canTeach && s.my_pending)"
        class="card todo-card"
        @click="router.push('/requests')"
      >
        <van-icon name="todo-list-o" size="20" color="#e07a00" />
        <div style="flex: 1; margin-left: 10px">
          <div style="font-size: 14px; font-weight: 600">
            {{ auth.canTeach ? `有 ${s.pending_requests} 条申请等待你处理` : `你有 ${s.my_pending} 条申请在审核中` }}
          </div>
          <div class="muted">点击查看请假与预约{{ auth.canTeach ? '审批' : '进度' }}</div>
        </div>
        <van-icon name="arrow" color="#c3c9d6" />
      </div>
    </template>

    <!-- 桌面端：页面标题 + 统计卡片 -->
    <template v-else>
      <div class="page-head">
        <div>
          <h1>{{ greeting() }}，{{ auth.user?.name }}</h1>
          <div class="sub">{{ fmtDate(new Date()) }} · 今天有 {{ dash.today_lessons.length }} 节课需要关注</div>
        </div>
        <div class="page-head-actions">
          <van-button v-if="auth.canTeach" round type="primary" icon="plus" @click="router.push('/schedule')">排课</van-button>
          <van-button round plain icon="friends-o" @click="router.push('/classes')">管理班级</van-button>
        </div>
      </div>

      <div class="grid-3">
        <div v-for="i in statItems" :key="i.label" class="stat-card">
          <div style="display: flex; align-items: center; gap: 10px">
            <van-icon name="chart-trending-o" size="20" color="#4f6ef2" />
            <div>
              <div class="stat-num" :style="i.warn ? { color: '#e07a00' } : {}">{{ i.value }}</div>
              <div class="stat-label">{{ i.label }}</div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div class="section-head">
      <span>今日课程</span>
      <span class="muted">共 {{ dash.today_lessons.length }} 节</span>
    </div>

    <div :class="isDesktop ? 'grid-2' : ''">
      <LessonCard v-for="l in dash.today_lessons" :key="l.id" :lesson="l" />
    </div>
    <van-empty v-if="!dash.today_lessons.length" image="search" description="今天没有课程安排" />

    <div v-if="!isDesktop && auth.canTeach" style="margin-top: 16px">
      <van-button round block type="primary" icon="plus" @click="router.push('/schedule')">去排课</van-button>
    </div>
  </div>
</template>

<style scoped>
.todo-card {
  display: flex;
  align-items: center;
  border-left: 3px solid #ffb35c;
  cursor: pointer;
}
</style>
