<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import api, { toastError } from '../../api';
import { useBack } from '../../composables/back';
import { addDays, cnDate, fmtDate } from '../../utils';

const router = useRouter();
const back = useBack('/schedule');
const todayStr = fmtDate(new Date());

const from = ref(todayStr);
const to = ref(addDays(todayStr, 6));
const loading = ref(false);
const rooms = ref([]);
const summary = ref(null);
/** 后端会把超长区间截断到 14 天，截断过就提示一句 */
const clamped = ref(false);

/* ---------------- 数据 ---------------- */
async function load() {
  loading.value = true;
  try {
    const d = await api.get('/rooms', { params: { from: from.value, to: to.value } });
    rooms.value = d.rooms;
    summary.value = d.summary;
    clamped.value = d.clamped;
    // 以实际生效的区间为准，避免输入框里还留着被截断的结束日期
    [from.value, to.value] = d.range;
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function shift(n) {
  from.value = addDays(from.value, n * 7);
  to.value = addDays(to.value, n * 7);
  load();
}

function goToday() {
  from.value = todayStr;
  to.value = addDays(todayStr, 6);
  load();
}
</script>

<template>
  <div class="page">
    <van-nav-bar title="教室占用" left-arrow @click-left="back()" />

    <div class="card">
      <van-cell-group inset>
        <van-field label="起始日期">
          <template #input><input v-model="from" type="date" class="d-input" /></template>
        </van-field>
        <van-field label="结束日期">
          <template #input><input v-model="to" type="date" class="d-input" /></template>
        </van-field>
      </van-cell-group>
      <div class="muted" style="margin: 8px 4px 0">
        <template v-if="clamped">区间已截断到 14 天。</template>
        同一间教室同一天时间重叠的课会被标成「冲突」
      </div>
      <div class="quick-row">
        <van-button size="small" round plain icon="arrow-left" @click="shift(-1)">上一周</van-button>
        <van-button size="small" round plain @click="goToday">今天</van-button>
        <van-button size="small" round plain icon="arrow" @click="shift(1)">下一周</van-button>
        <div style="flex: 1" />
        <van-button size="small" round type="primary" :loading="loading" @click="load()">查询</van-button>
      </div>
    </div>

    <van-loading v-if="loading" style="margin: 30px auto" vertical>加载中…</van-loading>
    <template v-else>
      <div v-if="summary" class="card">
        <div class="sum-row">
          <div class="sum-item"><b>{{ summary.room_count }}</b><span>间教室</span></div>
          <div class="sum-item"><b>{{ summary.lesson_count }}</b><span>节课</span></div>
          <div class="sum-item"><b :class="{ bad: summary.conflict_count }">{{ summary.conflict_count }}</b><span>处冲突</span></div>
        </div>
      </div>

      <div v-for="room in rooms" :key="room.name" class="card">
        <div class="room-head">
          <span class="room-name">{{ room.name }}</span>
          <div style="flex: 1" />
          <span class="muted">{{ room.lesson_count }} 节</span>
          <van-tag v-if="room.has_conflict" type="danger">冲突 {{ room.conflict_count }}</van-tag>
        </div>

        <div v-for="day in room.days" :key="day.date" class="room-day">
          <div class="day-label" :class="{ bad: day.conflict }">
            {{ cnDate(day.date) }}
            <template v-if="day.conflict"> · 冲突 {{ day.conflicts.length }}</template>
          </div>
          <div
            v-for="l in day.lessons"
            :key="l.id"
            class="m-slot"
            :class="{ bad: l.conflict }"
            @click="router.push(`/lessons/${l.id}`)"
          >
            <span class="t">{{ l.start_time }}-{{ l.end_time }}</span>
            <span class="n">{{ l.class_name }}</span>
            <span v-if="l.teacher_name" class="muted">{{ l.teacher_name }}</span>
            <div style="flex: 1" />
            <van-tag v-if="l.conflict" type="danger" plain>冲突</van-tag>
            <van-icon v-else name="arrow" color="#c3c9d6" />
          </div>
        </div>
      </div>

      <van-empty v-if="!rooms.length" image="search" description="这段时间没有教室被占用" />
    </template>
  </div>
</template>

<style scoped>
.quick-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.sum-row { display: flex; text-align: center; }
.sum-item { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.sum-item b { font-size: 20px; font-variant-numeric: tabular-nums; }
.sum-item b.bad { color: #d92b3f; }
.sum-item span { font-size: 12px; color: var(--eduhub-muted); }

.room-head { display: flex; align-items: center; gap: 8px; }
.room-name { font-size: 15px; font-weight: 600; }
.room-day { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--eduhub-line-2); }
.day-label { font-size: 12.5px; color: var(--eduhub-text-2); font-weight: 600; }
.day-label.bad { color: #d92b3f; }
.m-slot {
  display: flex; align-items: center; gap: 8px; margin-top: 6px; padding: 8px 10px;
  border: 1px solid var(--eduhub-line-2); border-radius: 10px; background: var(--eduhub-tint);
  font-size: 13px; cursor: pointer;
}
.m-slot .t { color: var(--eduhub-text-2); font-variant-numeric: tabular-nums; flex: none; }
.m-slot .n { font-weight: 600; color: var(--eduhub-text); }
.m-slot.bad { background: #fff5f6; border-color: #f4c3c9; }
.m-slot.bad .t { color: #c8172f; }

html.dark .m-slot { background: var(--eduhub-tint); border-color: var(--eduhub-line); }
html.dark .m-slot.bad { background: var(--eduhub-danger-bg); border-color: rgba(255, 128, 147, 0.4); }
html.dark .m-slot.bad .t, html.dark .day-label.bad, html.dark .sum-item b.bad { color: var(--eduhub-danger-text); }
</style>
