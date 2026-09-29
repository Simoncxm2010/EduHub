<script setup>
import { computed, ref } from 'vue';
import { endTime, LESSON_STATUS, minToTime } from '../utils';

/** 桌面端周日历：按时间定位课程块，重叠课程自动分栏，点空档直接排课 */
const props = defineProps({
  days: { type: Array, required: true },
  lessonsByDate: { type: Object, default: () => ({}) },
  hourHeight: { type: Number, default: 62 },
  nowMinute: { type: Number, default: null },
  /** date -> { name, type: 'holiday' | 'workday' }（国家法定节假日） */
  holidayMap: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['select', 'create']);

const toMin = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
};

const all = computed(() => Object.values(props.lessonsByDate).flat());

/** 有课的时间范围自动撑开，默认 8:00 - 22:00 */
const startHour = computed(() => {
  if (!all.value.length) return 8;
  const min = Math.min(...all.value.map((l) => toMin(l.start_time)));
  return Math.max(0, Math.min(8, Math.floor(min / 60)));
});
const endHour = computed(() => {
  if (!all.value.length) return 22;
  const max = Math.max(...all.value.map((l) => toMin(l.start_time) + Number(l.duration_min || 60)));
  return Math.min(24, Math.max(22, Math.ceil(max / 60)));
});
const hours = computed(() => {
  const out = [];
  for (let h = startHour.value; h <= endHour.value; h++) out.push(h);
  return out;
});
const bodyHeight = computed(() => (endHour.value - startHour.value) * props.hourHeight);

/** 同一列内重叠的课程分簇，簇内按可用车道数平分宽度 */
const layoutByDate = computed(() => {
  const result = {};
  for (const day of props.days) {
    const list = [...(props.lessonsByDate[day.date] || [])]
      .map((l) => {
        const start = toMin(l.start_time);
        return { lesson: l, start, end: start + Number(l.duration_min || 60) };
      })
      .sort((a, b) => a.start - b.start || a.lesson.id - b.lesson.id);

    const placed = [];
    let cluster = [];
    let clusterEnd = -1;

    const flush = () => {
      if (!cluster.length) return;
      const laneEnds = [];
      for (const item of cluster) {
        let lane = laneEnds.findIndex((e) => e <= item.start);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(item.end);
        } else {
          laneEnds[lane] = item.end;
        }
        item.lane = lane;
      }
      const cols = laneEnds.length;
      for (const item of cluster) placed.push({ ...item, cols });
      cluster = [];
      clusterEnd = -1;
    };

    for (const item of list) {
      if (cluster.length && item.start >= clusterEnd) flush();
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.end);
    }
    flush();
    result[day.date] = placed;
  }
  return result;
});

function blockStyle(b) {
  const top = ((b.start - startHour.value * 60) / 60) * props.hourHeight;
  // 跨零点的课（结束时间超出网格）裁剪到网格底，避免被 overflow:hidden 截断出锯齿
  const visibleEnd = Math.min(b.end, endHour.value * 60);
  const height = Math.max(30, ((visibleEnd - b.start) / 60) * props.hourHeight - 3);
  const width = 100 / b.cols;
  return {
    top: `${top}px`,
    height: `${height}px`,
    left: `calc(${b.lane * width}% + 2px)`,
    width: `calc(${width}% - 4px)`,
    '--bar': b.lesson.class_color,
  };
}

/** date 的节假日信息（null = 普通日） */
function holidayOf(date) {
  return props.holidayMap?.[date] ?? null;
}

/** 悬停时吸附到半小时，并显示将要排课的时间 */
const hover = ref(null);

function onColMove(e, date) {
  // 悬停在课程块上时不显示「在此新建」指示——虚线压在已有课上会像幻影
  if (e.target.closest('.wk-block')) {
    if (hover.value) hover.value = null;
    return;
  }
  const rect = e.currentTarget.getBoundingClientRect();
  const raw = ((e.clientY - rect.top) / props.hourHeight) * 60 + startHour.value * 60;
  const snapped = Math.round(raw / 30) * 30;
  const clamped = Math.max(startHour.value * 60, Math.min(snapped, endHour.value * 60 - 30));
  hover.value = { date, time: minToTime(clamped), top: ((clamped - startHour.value * 60) / 60) * props.hourHeight };
}

function onColLeave() {
  hover.value = null;
}

function onColClick(date) {
  emit('create', { date, start_time: hover.value?.date === date ? hover.value.time : '18:00' });
}

/** 当前时间线：超出可显示时段（比如深夜）就不画，避免画到网格外面 */
const nowTop = computed(() => {
  if (props.nowMinute == null) return null;
  const from = startHour.value * 60;
  const to = endHour.value * 60;
  if (props.nowMinute < from || props.nowMinute > to) return null;
  return ((props.nowMinute - from) / 60) * props.hourHeight;
});

function statusText(l) {
  return (LESSON_STATUS[l.status] || LESSON_STATUS.scheduled).text;
}
</script>

<template>
  <div class="wk">
    <div class="wk-head">
      <div class="wk-gutter" />
      <div
        v-for="d in days"
        :key="d.date"
        class="wk-dayhead"
        :class="{ today: d.isToday, holiday: holidayOf(d.date)?.type === 'holiday' }"
      >
        <span class="dow">{{ d.dow }}</span>
        <span class="num">{{ d.num }}</span>
        <!-- 固定高度的节日行：无节日也占位，保证 7 列表头等高对齐 -->
        <span
          class="wk-hol"
          :class="holidayOf(d.date)?.type"
          :title="holidayOf(d.date)?.name"
        >{{ holidayOf(d.date)?.name || '' }}</span>
      </div>
    </div>

    <div class="wk-body" :style="{ height: `${bodyHeight}px` }">
      <div class="wk-gutter">
        <div
          v-for="h in hours"
          :key="h"
          class="wk-hourlabel"
          :style="{ top: `${(h - startHour) * hourHeight}px` }"
        >{{ String(h).padStart(2, '0') }}:00</div>
      </div>

      <div class="wk-cols">
        <div
          v-for="d in days"
          :key="d.date"
          class="wk-col"
          :class="{ today: d.isToday, holiday: holidayOf(d.date)?.type === 'holiday' }"
          @mousemove="onColMove($event, d.date)"
          @mouseleave="onColLeave"
          @click="onColClick(d.date)"
        >
          <div
            v-for="h in hours"
            :key="h"
            class="wk-line"
            :style="{ top: `${(h - startHour) * hourHeight}px` }"
          />

          <!-- 悬停提示：点击即按这个时间排课 -->
          <div
            v-if="hover && hover.date === d.date"
            class="wk-hover"
            :style="{ top: `${hover.top}px` }"
          >
            <span>{{ hover.time }}</span>
          </div>

          <!-- 当前时间线（仅今天这一列） -->
          <div v-if="nowTop != null && d.isToday" class="wk-now" :style="{ top: `${nowTop}px` }">
            <i />
          </div>

          <div
            v-for="b in layoutByDate[d.date] || []"
            :key="b.lesson.id"
            class="wk-block"
            :class="{ canceled: b.lesson.status === 'canceled', done: b.lesson.status === 'done' }"
            :style="blockStyle(b)"
            :title="`${b.lesson.class_name} ${b.lesson.start_time}-${endTime(b.lesson.start_time, b.lesson.duration_min)}`"
            @click.stop="emit('select', b.lesson)"
          >
            <div class="wk-block-time">{{ b.lesson.start_time }} - {{ endTime(b.lesson.start_time, b.lesson.duration_min) }}</div>
            <div class="wk-block-title">{{ b.lesson.class_name }}</div>
            <div class="wk-block-meta">
              <span v-if="b.lesson.room">{{ b.lesson.room }}</span>
              <span v-if="b.lesson.status !== 'scheduled'" class="wk-block-status">{{ statusText(b.lesson) }}</span>
              <span v-else-if="b.lesson.checked_count" class="wk-block-checked">签到 {{ b.lesson.checked_count }}/{{ b.lesson.student_count }}</span>
            </div>
            <div v-if="b.lesson.topic" class="wk-block-topic">{{ b.lesson.topic }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
