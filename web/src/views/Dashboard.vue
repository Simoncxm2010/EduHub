<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import api, { toastError } from '../api';
import { useAuthStore } from '../store';
import { isDesktop } from '../composables/layout';
import { cnDate, fmtDate, greeting } from '../utils';
import LessonCard from '../components/LessonCard.vue';

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

const statItems = computed(() => [
  { label: '本周课时', value: dash.value.stats.week_lessons ?? 0, icon: 'calendar-o' },
  {
    label: auth.isTeacher ? '学生人数' : '已加入班级',
    value: dash.value.stats.student_count ?? dash.value.stats.class_count ?? 0,
    icon: 'friends-o',
  },
  { label: '班级数量', value: dash.value.stats.class_count ?? 0, icon: 'cluster-o' },
]);
</script>

<template>
  <div class="page">
    <!-- 移动端：渐变头图 -->
    <template v-if="!isDesktop">
      <header class="hero">
        <div class="hero-greeting">{{ greeting() }}，{{ auth.user?.name }}</div>
        <div class="hero-sub">{{ cnDate(dash.today) }} · 本周 {{ dash.stats.week_lessons ?? 0 }} 节课</div>
      </header>

      <div class="card stats hero-overlap">
        <div style="display: flex; text-align: center">
          <div v-for="s in statItems" :key="s.label" style="flex: 1">
            <div class="stat-num">{{ s.value }}</div>
            <div class="stat-label">{{ s.label }}</div>
          </div>
        </div>
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
          <van-button v-if="auth.isTeacher" round type="primary" icon="plus" @click="router.push('/schedule')">排课</van-button>
          <van-button round plain icon="friends-o" @click="router.push('/classes')">管理班级</van-button>
        </div>
      </div>

      <div class="grid-3">
        <div v-for="s in statItems" :key="s.label" class="stat-card">
          <div style="display: flex; align-items: center; gap: 10px">
            <van-icon :name="s.icon" size="20" color="#4f6ef2" />
            <div>
              <div class="stat-num">{{ s.value }}</div>
              <div class="stat-label">{{ s.label }}</div>
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

    <div v-if="!isDesktop && auth.isTeacher" style="margin-top: 16px">
      <van-button round block type="primary" icon="plus" @click="router.push('/schedule')">去排课</van-button>
    </div>
  </div>
</template>
