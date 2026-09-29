<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import { addDays, fmtDate, monthStartOf, nowMinutes, weekStartOf, WEEKDAY_SHORT } from '../../utils';
import { ensureHolidays } from '../../utils/holidays';
import WeekGrid from '../../components/WeekGrid.vue';
import MonthGrid from '../../components/MonthGrid.vue';
import LessonFormModal from './LessonFormModal.vue';
import SmartPlanModal from './SmartPlanModal.vue';

const router = useRouter();
const auth = useAuthStore();
const todayStr = fmtDate(new Date());

const viewMode = ref(localStorage.getItem('eduhub_cal_view') || 'week');
const anchor = ref(todayStr);
const selected = ref(todayStr);
const classFilter = ref(null);
const classes = ref([]);
const lessons = ref({});
const loading = ref(true);
const now = ref(nowMinutes());
/** date -> { name, type: 'holiday' | 'workday' }（国家法定节假日） */
const holidayMap = ref({});
let timer = null;

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
    out.push({ date: d, num: dt.getDate(), dow: `周${WEEKDAY_SHORT[dt.getDay()]}`, isToday: d === todayStr });
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
const rangeCount = computed(() => Object.values(lessons.value).reduce((n, l) => n + l.length, 0));
const monthLabel = computed(() => `${anchor.value.slice(0, 4)} 年 ${Number(anchor.value.slice(5, 7))} 月`);
const nowMinuteForGrid = computed(() =>
  viewMode.value === 'week' && weekDays.value.some((d) => d.isToday) ? now.value : null);

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
  ensureHolidays().then((m) => { holidayMap.value = m; });
  try {
    const d = await api.get('/classes');
    classes.value = d.classes;
  } catch (e) {
    toastError(e);
  }
  await load();
  timer = setInterval(() => { now.value = nowMinutes(); }, 60000);
});
onUnmounted(() => clearInterval(timer));

watch([viewMode, classFilter], () => {
  localStorage.setItem('eduhub_cal_view', viewMode.value);
  load();
});

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

/* 排课表单 */
const showForm = ref(false);
const formPreset = ref({});
const showSmart = ref(false);

function openForm(preset = {}) {
  if (!auth.canTeach) return;
  if (!classes.value.length) return toastError(new Error('请先在「班级」页创建班级'));
  // start_time 来自点击位置，duration_min 来自拖拽框选（只点一下时为空，用表单默认值）
  formPreset.value = {
    date: preset.date || selected.value,
    start_time: preset.start_time,
    duration_min: preset.duration_min,
    class_id: classFilter.value,
  };
  showForm.value = true;
}

async function onCreated(d) {
  const first = d.created?.[0] || d.lessons?.[0];
  if (first) {
    anchor.value = first.date;
    selected.value = first.date;
    if (viewMode.value === 'month') viewMode.value = 'week';
  }
  await load();
}

function openLesson(l) {
  router.push(`/lessons/${l.id}`);
}
</script>

<template>
  <div class="d-page">
    <div class="d-head">
      <div>
        <h1>排课</h1>
        <div class="sub">
          <template v-if="viewMode === 'week'">{{ weekStart }} 至 {{ weekEnd }} · 共 {{ rangeCount }} 节课</template>
          <template v-else>{{ monthLabel }} · 当前视图共 {{ rangeCount }} 节课</template>
        </div>
      </div>
      <div class="d-head-actions">
        <div class="d-tabs">
          <button :class="{ on: viewMode === 'week' }" @click="viewMode = 'week'">周</button>
          <button :class="{ on: viewMode === 'month' }" @click="viewMode = 'month'">月</button>
        </div>
        <button class="d-btn" @click="shift(-1)">上一{{ viewMode === 'week' ? '周' : '月' }}</button>
        <button class="d-btn" @click="goToday">今天</button>
        <button class="d-btn" @click="shift(1)">下一{{ viewMode === 'week' ? '周' : '月' }}</button>
        <button v-if="auth.canTeach" class="d-btn" @click="showSmart = true">智能排课</button>
        <button v-if="auth.canTeach" class="d-btn primary" @click="openForm()">新建排课</button>
      </div>
    </div>

    <div v-if="classes.length > 1" class="d-toolbar">
      <span style="font-size: 12.5px; color: #98a1b5">按班级筛选</span>
      <span class="chip" :class="{ on: !classFilter }" @click="classFilter = null">全部班级</span>
      <span
        v-for="c in classes"
        :key="c.id"
        class="chip"
        :class="{ on: classFilter === c.id }"
        :style="classFilter === c.id ? { background: c.color, borderColor: c.color, color: '#fff' } : {}"
        @click="classFilter = classFilter === c.id ? null : c.id"
      >
        <i class="chip-dot" :style="{ background: c.color }" />{{ c.name }}
      </span>
    </div>

    <div class="d-split">
      <div class="d-col">
        <div v-if="loading" class="d-empty">加载中…</div>
        <template v-else>
          <WeekGrid
            v-if="viewMode === 'week'"
            :days="weekDays"
            :lessons-by-date="lessons"
            :now-minute="nowMinuteForGrid"
            :holiday-map="holidayMap"
            @select="openLesson"
            @create="openForm"
          />
          <MonthGrid
            v-else
            :days="monthDays"
            :holiday-map="holidayMap"
            @select-day="(d) => { selected = d; anchor = d; viewMode = 'week'; load(); }"
            @select-lesson="openLesson"
          />
        </template>
        <div style="font-size: 12.5px; color: #98a1b5">
          <template v-if="viewMode === 'week'">
            {{ auth.canTeach ? '把鼠标移到空白时段会显示将要排课的时间：点一下按该时间排课，按住拖出起止时间可连时长一起定下；点课程块进入签到与记录。' : '点课程块查看签到与课堂记录。' }}
          </template>
          <template v-else>
            {{ auth.canTeach ? '点某一天会切到周视图并可直接排课。' : '点某一天查看当天课程。' }}
          </template>
        </div>
      </div>

      <div class="d-col">
        <div class="d-card">
          <div class="d-card-title">
            <span>{{ selected === todayStr ? '今日课程' : `${selected} 周${WEEKDAY_SHORT[new Date(`${selected}T00:00:00`).getDay()]}` }}</span>
            <span class="d-badge mute">{{ dayLessons.length }} 节</span>
          </div>
          <div v-if="!dayLessons.length" class="d-empty" style="padding: 24px 10px">
            <strong>这一天没有课程</strong>
            <template v-if="auth.canTeach">点左侧日历空白处即可排课</template>
          </div>
          <div v-else class="d-rows">
            <div v-for="l in dayLessons" :key="l.id" class="d-row" style="cursor: pointer" @click="openLesson(l)">
              <span class="d-dot" :style="{ background: l.class_color, width: '10px', height: '10px' }" />
              <div class="grow">
                <div class="title">{{ l.start_time }} - {{ l.class_name }}</div>
                <div class="meta">
                  <template v-if="l.room">{{ l.room }} · </template>
                  {{ l.duration_min }} 分钟 · 签到 {{ l.checked_count }}/{{ l.student_count }}
                  <template v-if="l.signed_count"> · 签名 {{ l.signed_count }}</template>
                </div>
              </div>
              <span class="d-badge" :class="l.status === 'done' ? 'ok' : l.status === 'canceled' ? 'mute' : 'info'">
                {{ l.status === 'done' ? '已完成' : l.status === 'canceled' ? '已取消' : '待上课' }}
              </span>
            </div>
          </div>
        </div>

        <div class="d-card">
          <div class="d-card-title"><span>快捷操作</span></div>
          <div class="d-rows">
            <div v-if="auth.canTeach" class="d-row" style="cursor: pointer" @click="openForm({ date: selected })">
              <div class="grow"><div class="title">在 {{ selected }} 排一节课</div><div class="meta">会带上当前选中的日期</div></div>
              <van-icon name="arrow" color="#c3c9d6" />
            </div>
            <div class="d-row" style="cursor: pointer" @click="router.push('/availability')">
              <div class="grow"><div class="title">智能协调时间</div><div class="meta">找出师生都有空的时段</div></div>
              <van-icon name="arrow" color="#c3c9d6" />
            </div>
            <div class="d-row" style="cursor: pointer" @click="router.push('/me')">
              <div class="grow"><div class="title">订阅到手机日历</div><div class="meta">课表自动同步，上课前提醒</div></div>
              <van-icon name="arrow" color="#c3c9d6" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <LessonFormModal v-model:show="showForm" :classes="classes" :preset="formPreset" @created="onCreated" />
    <SmartPlanModal v-model:show="showSmart" :classes="classes" :preset-class-id="classFilter" @created="onCreated" />
  </div>
</template>
