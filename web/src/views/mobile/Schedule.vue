<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import api, { toastError } from '../api';
import { useAuthStore } from '../store';
import { isDesktop } from '../composables/layout';
import {
  addDays, cnDate, fmtDate, monthStartOf, nowMinutes, weekStartOf, WEEKDAY_SHORT,
} from '../utils';
import LessonCard from '../components/LessonCard.vue';
import WeekGrid from '../components/WeekGrid.vue';
import MonthGrid from '../components/MonthGrid.vue';
import LessonFormDialog from '../components/LessonFormDialog.vue';
import SmartPlanDialog from '../components/SmartPlanDialog.vue';

const auth = useAuthStore();
const todayStr = fmtDate(new Date());

const viewMode = ref(localStorage.getItem('eduhub_cal_view') || 'week'); // week | month
const anchor = ref(todayStr);
const selected = ref(todayStr);
const classFilter = ref(null);
const classes = ref([]);
const lessons = ref({});
const loading = ref(false);
const now = ref(nowMinutes());

let timer = null;
onMounted(() => {
  timer = setInterval(() => { now.value = nowMinutes(); }, 60000);
});
onUnmounted(() => clearInterval(timer));

/* ---------------- 时间范围 ---------------- */
const weekStart = computed(() => weekStartOf(anchor.value));
const weekEnd = computed(() => addDays(weekStart.value, 6));
const gridStart = computed(() => weekStartOf(monthStartOf(anchor.value)));
const gridEnd = computed(() => addDays(gridStart.value, 41));
const rangeFrom = computed(() => (viewMode.value === 'week' ? weekStart.value : gridStart.value));
const rangeTo = computed(() => (viewMode.value === 'week' ? weekEnd.value : gridEnd.value));

const weekDays = computed(() => {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart.value, i);
    const dt = new Date(`${d}T00:00:00`);
    out.push({
      date: d,
      num: dt.getDate(),
      dow: `周${WEEKDAY_SHORT[dt.getDay()]}`,
      dowShort: WEEKDAY_SHORT[dt.getDay()],
      isToday: d === todayStr,
    });
  }
  return out;
});

const monthDays = computed(() => {
  const month = monthStartOf(anchor.value).slice(0, 7);
  const out = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart.value, i);
    out.push({
      date,
      day: Number(date.slice(8, 10)),
      inMonth: date.slice(0, 7) === month,
      isToday: date === todayStr,
      selected: date === selected.value,
      lessons: lessons.value[date] || [],
    });
  }
  return out;
});

const dayLessons = computed(() => lessons.value[selected.value] || []);
const weekLessonCount = computed(() => Object.values(lessons.value).reduce((n, list) => n + list.length, 0));
const monthLabel = computed(() => `${anchor.value.slice(0, 4)} 年 ${Number(anchor.value.slice(5, 7))} 月`);
const rangeLabel = computed(() => `${weekStart.value.slice(5).replace('-', '/')} - ${weekEnd.value.slice(5).replace('-', '/')}`);

/** 当前时间线只画在今天这一列的范围内 */
const nowMinuteForGrid = computed(() => {
  if (viewMode.value !== 'week') return null;
  if (!weekDays.value.some((d) => d.isToday)) return null;
  return now.value;
});

/* ---------------- 数据 ---------------- */
async function loadClasses() {
  try {
    const d = await api.get('/classes');
    classes.value = d.classes;
  } catch (e) {
    toastError(e);
  }
}

async function load() {
  loading.value = true;
  try {
    const params = { from: rangeFrom.value, to: rangeTo.value };
    if (classFilter.value) params.class_id = classFilter.value;
    const d = await api.get('/lessons', { params });
    const map = {};
    for (const l of d.lessons) (map[l.date] ||= []).push(l);
    lessons.value = map;
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  await loadClasses();
  await load();
});

watch([viewMode, classFilter], () => {
  localStorage.setItem('eduhub_cal_view', viewMode.value);
  load();
});

function setFilter(id) {
  classFilter.value = classFilter.value === id ? null : id;
}

function shift(n) {
  if (viewMode.value === 'week') {
    anchor.value = addDays(weekStart.value, n * 7);
    selected.value = anchor.value;
  } else {
    const d = new Date(`${monthStartOf(anchor.value)}T00:00:00`);
    d.setMonth(d.getMonth() + n, 1);
    anchor.value = fmtDate(d);
  }
  load();
}

function goToday() {
  anchor.value = todayStr;
  selected.value = todayStr;
  load();
}

function onMonthSelectDay(date) {
  selected.value = date;
  anchor.value = date;
  if (!isDesktop.value) {
    // 手机上点月视图的某天，直接切回周视图看当天详情
    viewMode.value = 'week';
  } else {
    load();
  }
}

/* ---------------- 排课对话框 ---------------- */
const showForm = ref(false);
const showSmart = ref(false);
const formPreset = ref({});

async function openForm(preset = {}) {
  if (!classes.value.length) await loadClasses();
  if (!classes.value.length) return toastError(new Error('请先在「班级」页创建班级'));
  formPreset.value = { date: preset.date || selected.value, start_time: preset.start_time, class_id: classFilter.value };
  showForm.value = true;
}

async function openSmart() {
  if (!classes.value.length) await loadClasses();
  if (!classes.value.length) return toastError(new Error('请先在「班级」页创建班级'));
  showSmart.value = true;
}

async function onCreated(d) {
  const first = d.created?.[0] || d.lessons?.[0];
  if (first) {
    anchor.value = first.date;
    selected.value = first.date;
  }
  await load();
}
</script>

<template>
  <div class="page">
    <!-- ============ 桌面端 ============ -->
    <template v-if="isDesktop">
      <div class="page-head">
        <div>
          <h1>排课</h1>
          <div class="sub">
            <template v-if="viewMode === 'week'">{{ weekStart }} 至 {{ weekEnd }} · 本周 {{ weekLessonCount }} 节课</template>
            <template v-else>{{ monthLabel }} · 本月共 {{ weekLessonCount }} 节课</template>
          </div>
        </div>
        <div class="page-head-actions">
          <div class="seg-toggle">
            <button :class="{ on: viewMode === 'week' }" @click="viewMode = 'week'">周</button>
            <button :class="{ on: viewMode === 'month' }" @click="viewMode = 'month'">月</button>
          </div>
          <van-button round plain icon="arrow-left" @click="shift(-1)">{{ viewMode === 'week' ? '上一周' : '上一月' }}</van-button>
          <van-button round plain @click="goToday">今天</van-button>
          <van-button round plain icon="arrow" @click="shift(1)">{{ viewMode === 'week' ? '下一周' : '下一月' }}</van-button>
          <van-button v-if="auth.isTeacher" round plain type="primary" icon="bulb-o" @click="openSmart">智能排课</van-button>
          <van-button v-if="auth.isTeacher" round type="primary" icon="plus" @click="openForm()">新建排课</van-button>
        </div>
      </div>

      <div v-if="classes.length > 1" class="filter-bar">
        <span class="chip" :class="{ on: !classFilter }" @click="classFilter = null">全部班级</span>
        <span
          v-for="c in classes"
          :key="c.id"
          class="chip"
          :class="{ on: classFilter === c.id }"
          :style="classFilter === c.id ? { background: c.color, borderColor: c.color, color: '#fff' } : {}"
          @click="setFilter(c.id)"
        >
          <i class="chip-dot" :style="{ background: c.color }" />{{ c.name }}
        </span>
      </div>

      <van-loading v-if="loading" style="margin: 40px auto" vertical>加载中…</van-loading>
      <template v-else>
        <WeekGrid
          v-if="viewMode === 'week'"
          :days="weekDays"
          :lessons-by-date="lessons"
          :now-minute="nowMinuteForGrid"
          @select="(l) => $router.push(`/lessons/${l.id}`)"
          @create="(p) => auth.isTeacher && openForm(p)"
        />
        <MonthGrid
          v-else
          :days="monthDays"
          @select-day="onMonthSelectDay"
          @select-lesson="(l) => $router.push(`/lessons/${l.id}`)"
        />
        <div class="muted" style="margin-top: 10px">
          <template v-if="viewMode === 'week'">
            {{ auth.isTeacher ? '鼠标移到空白时段会显示将要排课的时间，点击即可按该时间排课；点击课程块查看签到与记录。' : '点击课程块查看签到与课堂记录。' }}
          </template>
          <template v-else>
            {{ auth.isTeacher ? '点击某一天可切到周视图并直接排课。' : '点击某一天查看当天课程。' }}
          </template>
        </div>
      </template>
    </template>

    <!-- ============ 移动端 ============ -->
    <template v-else>
      <van-nav-bar title="排课" />

      <div class="seg-toggle seg-toggle-block">
        <button :class="{ on: viewMode === 'week' }" @click="viewMode = 'week'">周视图</button>
        <button :class="{ on: viewMode === 'month' }" @click="viewMode = 'month'">月视图</button>
      </div>

      <div v-if="classes.length > 1" class="filter-bar">
        <span class="chip" :class="{ on: !classFilter }" @click="classFilter = null">全部</span>
        <span
          v-for="c in classes"
          :key="c.id"
          class="chip"
          :class="{ on: classFilter === c.id }"
          :style="classFilter === c.id ? { background: c.color, borderColor: c.color, color: '#fff' } : {}"
          @click="setFilter(c.id)"
        >
          <i class="chip-dot" :style="{ background: c.color }" />{{ c.name }}
        </span>
      </div>

      <!-- 周视图：周条 + 当日列表 -->
      <template v-if="viewMode === 'week'">
        <div class="card">
          <div class="week-nav">
            <van-icon name="arrow-left" @click="shift(-1)" />
            <span class="title" @click="goToday">{{ rangeLabel }}</span>
            <van-icon name="arrow" @click="shift(1)" />
          </div>
          <div class="week-days">
            <div
              v-for="d in weekDays"
              :key="d.date"
              class="day"
              :class="{ sel: d.date === selected, today: d.date === todayStr }"
              @click="selected = d.date"
            >
              <div class="dow">{{ d.dowShort }}</div>
              <div class="num">{{ d.num }}</div>
              <div v-if="(lessons[d.date] || []).length" class="dot" />
            </div>
          </div>
        </div>

        <div class="section-head">
          <span>{{ selected === todayStr ? '今日课程' : cnDate(selected) }}</span>
          <span class="muted">共 {{ dayLessons.length }} 节</span>
        </div>
        <van-loading v-if="loading" style="margin: 30px auto" vertical>加载中…</van-loading>
        <template v-else>
          <LessonCard v-for="l in dayLessons" :key="l.id" :lesson="l" />
          <van-empty v-if="!dayLessons.length" image="search" description="这一天没有课程" />
        </template>
      </template>

      <!-- 月视图 -->
      <template v-else>
        <div class="card" style="padding: 12px">
          <div class="week-nav">
            <van-icon name="arrow-left" @click="shift(-1)" />
            <span class="title" @click="goToday">{{ monthLabel }}</span>
            <van-icon name="arrow" @click="shift(1)" />
          </div>
          <van-loading v-if="loading" style="margin: 24px auto" vertical>加载中…</van-loading>
          <MonthGrid v-else :days="monthDays" compact @select-day="onMonthSelectDay" />
          <div class="muted" style="text-align: center; margin-top: 8px">点某一天可查看当天课程</div>
        </div>
      </template>

      <div v-if="auth.isTeacher" class="fab-group">
        <button class="fab fab-minor" title="智能排课" @click="openSmart">
          <van-icon name="bulb-o" size="20" />
        </button>
        <button class="fab" title="新建排课" @click="openForm()">+</button>
      </div>
    </template>

    <LessonFormDialog v-model:show="showForm" :classes="classes" :preset="formPreset" @created="onCreated" />
    <SmartPlanDialog v-model:show="showSmart" :classes="classes" @created="onCreated" />
  </div>
</template>
