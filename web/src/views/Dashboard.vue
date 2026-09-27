<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import api, { toastError } from '../api';
import { useAuthStore } from '../store';
import { cnDate, greeting } from '../utils';
import LessonCard from '../components/LessonCard.vue';
import TabBar from '../components/TabBar.vue';

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
  { label: '本周课时', value: dash.value.stats.week_lessons ?? 0 },
  { label: auth.isTeacher ? '学生人数' : '已加入班级', value: dash.value.stats.student_count ?? dash.value.stats.class_count ?? 0 },
  { label: '班级数量', value: dash.value.stats.class_count ?? 0 },
]);
</script>

<template>
  <div class="page">
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

    <div class="section-head">
      <span>今日课程</span>
      <span class="muted">共 {{ dash.today_lessons.length }} 节</span>
    </div>

    <LessonCard v-for="l in dash.today_lessons" :key="l.id" :lesson="l" />
    <van-empty v-if="!dash.today_lessons.length" image="search" description="今天没有课程安排" />

    <div v-if="auth.isTeacher" style="margin-top: 16px">
      <van-button round block type="primary" icon="plus" @click="router.push('/schedule')">去排课</van-button>
    </div>

    <TabBar />
  </div>
</template>
