<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { showToast } from 'vant';
import api, { toastError } from '../api';
import { useAuthStore } from '../store';
import { addDays, cnDate, fmtDate, weekStartOf } from '../utils';
import LessonCard from '../components/LessonCard.vue';
import TabBar from '../components/TabBar.vue';

const auth = useAuthStore();
const todayStr = fmtDate(new Date());
const anchor = ref(todayStr); // 当前周的任一天
const selected = ref(todayStr);
const lessons = ref({});
const loading = ref(false);

const weekStart = computed(() => weekStartOf(anchor.value));
const weekEnd = computed(() => addDays(weekStart.value, 6));
const weekDays = computed(() => {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart.value, i);
    const dt = new Date(`${d}T00:00:00`);
    out.push({ date: d, num: dt.getDate(), dow: '一二三四五六日'[(dt.getDay() + 6) % 7] });
  }
  return out;
});
const dayLessons = computed(() => lessons.value[selected.value] || []);
const rangeLabel = computed(() => `${weekStart.value.slice(5).replace('-', '/')} - ${weekEnd.value.slice(5).replace('-', '/')}`);

function hasLessons(d) {
  return (lessons.value[d] || []).length > 0;
}

function shiftWeek(n) {
  anchor.value = addDays(weekStart.value, n * 7);
  selected.value = anchor.value;
  load();
}

function goToday() {
  anchor.value = todayStr;
  selected.value = todayStr;
  load();
}

async function load() {
  loading.value = true;
  try {
    const d = await api.get('/lessons', { params: { from: weekStart.value, to: weekEnd.value } });
    const map = {};
    for (const l of d.lessons) (map[l.date] ||= []).push(l);
    lessons.value = map;
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

/* ---------- 新建排课（教师） ---------- */
const showForm = ref(false);
const classes = ref([]);
const form = reactive({ class_id: null, class_name: '', date: '', start_time: '', duration_min: 90, room: '', topic: '', repeat_weeks: 1 });
const showClassPicker = ref(false);
const showTimePicker = ref(false);
const showDurPicker = ref(false);
const showCalendar = ref(false);
const submitting = ref(false);

const hourCol = Array.from({ length: 17 }, (_, i) => String(i + 6).padStart(2, '0'));
const minuteCol = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
const timeColumns = [{ values: [...hourCol] }, { values: [...minuteCol] }];
const durationOptions = [30, 40, 45, 60, 75, 90, 120, 180].map((v) => ({ text: `${v} 分钟`, value: v }));

async function openForm() {
  if (!classes.value.length) {
    try {
      const d = await api.get('/classes');
      classes.value = d.classes;
    } catch (e) {
      toastError(e);
      return;
    }
    if (!classes.value.length) return showToast('请先在「班级」页创建班级');
  }
  form.date = selected.value || todayStr;
  form.start_time = form.start_time || '18:00';
  showForm.value = true;
}

function pickClass({ selectedOptions }) {
  form.class_id = selectedOptions[0]?.value;
  form.class_name = selectedOptions[0]?.text;
  showClassPicker.value = false;
}

function pickTime({ selectedValues }) {
  form.start_time = `${selectedValues[0]}:${selectedValues[1]}`;
  showTimePicker.value = false;
}

function pickDuration({ selectedOptions }) {
  form.duration_min = selectedOptions[0]?.value;
  showDurPicker.value = false;
}

function pickDate(d) {
  form.date = fmtDate(d);
  showCalendar.value = false;
}

async function submitForm() {
  if (!form.class_id) return showToast('请选择班级');
  if (!form.date) return showToast('请选择日期');
  if (!form.start_time) return showToast('请选择时间');
  submitting.value = true;
  try {
    const d = await api.post('/lessons', { ...form });
    showToast(`已排 ${d.lessons.length} 节课`);
    showForm.value = false;
    anchor.value = form.date;
    selected.value = form.date;
    load();
  } catch (e) {
    toastError(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="page">
    <van-nav-bar title="排课" />

    <div class="card">
      <div class="week-nav">
        <van-icon name="arrow-left" @click="shiftWeek(-1)" />
        <span class="title" @click="goToday">{{ rangeLabel }}</span>
        <van-icon name="arrow" @click="shiftWeek(1)" />
      </div>
      <div class="week-days">
        <div
          v-for="d in weekDays"
          :key="d.date"
          class="day"
          :class="{ sel: d.date === selected, today: d.date === todayStr }"
          @click="selected = d.date"
        >
          <div class="dow">{{ d.dow }}</div>
          <div class="num">{{ d.num }}</div>
          <div v-if="hasLessons(d.date)" class="dot" />
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

    <button v-if="auth.isTeacher" class="fab" @click="openForm">+</button>

    <!-- 新建排课 -->
    <van-popup v-model:show="showForm" round position="bottom" style="padding: 18px 4px 24px">
      <div class="form-title">新建排课</div>
      <van-cell-group inset>
        <van-field
          :model-value="form.class_name"
          label="班级"
          placeholder="选择班级"
          readonly
          is-link
          @click="showClassPicker = true"
        />
        <van-field :model-value="form.date" label="日期" placeholder="选择日期" readonly is-link @click="showCalendar = true" />
        <van-field :model-value="form.start_time" label="开始时间" placeholder="选择时间" readonly is-link @click="showTimePicker = true" />
        <van-field
          :model-value="form.duration_min ? form.duration_min + ' 分钟' : ''"
          label="时长"
          placeholder="选择时长"
          readonly
          is-link
          @click="showDurPicker = true"
        />
        <van-field v-model="form.room" label="教室" placeholder="如：301 教室（选填）" />
        <van-field v-model="form.topic" label="主题" placeholder="本节课内容（选填）" />
        <van-field label="每周重复">
          <template #input>
            <van-stepper v-model="form.repeat_weeks" :min="1" :max="16" />
            <span class="muted" style="margin-left: 8px">周</span>
          </template>
        </van-field>
      </van-cell-group>
      <div style="margin: 16px">
        <van-button round block type="primary" :loading="submitting" @click="submitForm">确认排课</van-button>
      </div>
    </van-popup>

    <van-popup v-model:show="showClassPicker" round position="bottom">
      <van-picker :columns="classes.map((c) => ({ text: c.name, value: c.id }))" @confirm="pickClass" @cancel="showClassPicker = false" />
    </van-popup>

    <van-popup v-model:show="showTimePicker" round position="bottom">
      <van-picker title="选择时间" :columns="timeColumns" @confirm="pickTime" @cancel="showTimePicker = false" />
    </van-popup>

    <van-popup v-model:show="showDurPicker" round position="bottom">
      <van-picker title="选择时长" :columns="durationOptions" @confirm="pickDuration" @cancel="showDurPicker = false" />
    </van-popup>

    <van-calendar v-model:show="showCalendar" :min-date="new Date(2020, 0, 1)" :max-date="new Date(2032, 11, 31)" @confirm="pickDate" />

    <TabBar />
  </div>
</template>
