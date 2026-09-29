<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import api, { toastError } from '../../api';
import { addDays, fmtDate, WEEKDAY_SHORT } from '../../utils';

const router = useRouter();
const todayStr = fmtDate(new Date());

const from = ref(todayStr);
const to = ref(addDays(todayStr, 6));
const loading = ref(false);
const days = ref([]);
const rooms = ref([]);
const summary = ref(null);
/** 后端会把超长区间截断到 14 天，截断过就提示一句 */
const clamped = ref(false);

/* ---------------- 数据 ---------------- */
async function load() {
  loading.value = true;
  try {
    const d = await api.get('/rooms', { params: { from: from.value, to: to.value } });
    days.value = d.days;
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

/** 某间教室某天的占用；后端只给有课的日子，其余按空处理 */
function cellOf(room, date) {
  return room.days.find((d) => d.date === date) || { lessons: [], conflicts: [], conflict: false };
}

function dayLabel(date) {
  return `${date.slice(5)} 周${WEEKDAY_SHORT[new Date(`${date}T00:00:00`).getDay()]}`;
}
</script>

<template>
  <div class="d-page">
    <div class="d-head">
      <div>
        <h1>教室占用</h1>
        <div class="sub">
          {{ from }} 至 {{ to }} · 共 {{ summary?.room_count ?? 0 }} 间教室、{{ summary?.lesson_count ?? 0 }} 节课
          <span v-if="summary?.conflict_count" class="clash-text"> · {{ summary.conflict_count }} 处冲突</span>
        </div>
      </div>
      <div class="d-head-actions">
        <button class="d-btn" @click="shift(-1)">上一周</button>
        <button class="d-btn" @click="goToday">今天</button>
        <button class="d-btn" @click="shift(1)">下一周</button>
      </div>
    </div>

    <div class="d-card">
      <div class="d-form" style="grid-template-columns: repeat(4, minmax(0, 1fr))">
        <div class="d-field">
          <label>起始日期</label>
          <input v-model="from" type="date" class="d-input" />
        </div>
        <div class="d-field">
          <label>结束日期</label>
          <input v-model="to" type="date" class="d-input" />
        </div>
        <div class="d-field">
          <label>查询范围</label>
          <span class="hint">一次最多看 14 天，超出会自动截断</span>
        </div>
        <div class="d-field" style="justify-content: flex-end">
          <button class="d-btn primary" :disabled="loading" @click="load()">
            {{ loading ? '查询中…' : '查询' }}
          </button>
        </div>
      </div>
    </div>

    <div class="d-split" style="margin-top: 16px">
      <div class="d-col">
        <div class="d-card">
          <div class="d-card-title">
            <span>占用总览</span>
            <span class="d-inline">
              <span v-if="clamped" class="d-badge warn">已截断到 14 天</span>
              <span class="d-badge mute">行 = 教室，列 = 日期</span>
            </span>
          </div>

          <div v-if="loading" class="d-empty">加载中…</div>
          <div v-else-if="!rooms.length" class="d-empty">
            <strong>这段时间没有教室被占用</strong>
            只有填了教室的课程才会出现在这里，没填教室的课不占教室
          </div>
          <div v-else class="d-scroll">
            <table class="d-table room-table">
              <thead>
                <tr>
                  <th>教室</th>
                  <th v-for="d in days" :key="d" class="center" :class="{ today: d === todayStr }">
                    {{ dayLabel(d) }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="room in rooms" :key="room.name">
                  <td class="strong">
                    {{ room.name }}
                    <div class="muted">
                      {{ room.lesson_count }} 节<template v-if="room.has_conflict"> ·
                        <span class="clash-text">冲突 {{ room.conflict_count }}</span>
                      </template>
                    </div>
                  </td>
                  <td
                    v-for="d in days"
                    :key="d"
                    class="room-cell"
                    :class="{ clash: cellOf(room, d).conflict, today: d === todayStr }"
                  >
                    <div
                      v-for="l in cellOf(room, d).lessons"
                      :key="l.id"
                      class="room-slot"
                      :class="{ bad: l.conflict }"
                      :title="`${l.start_time}-${l.end_time} ${l.class_name}${l.teacher_name ? ` · ${l.teacher_name}` : ''}`"
                      @click="router.push(`/lessons/${l.id}`)"
                    >
                      <span class="t">{{ l.start_time }}-{{ l.end_time }}</span>
                      <span class="n">{{ l.class_name }}</span>
                      <span v-if="l.conflict" class="clash-text">冲突</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="d-col">
        <div class="d-card">
          <div class="d-card-title">
            <span>冲突</span>
            <span class="d-badge" :class="summary?.conflict_count ? 'danger' : 'ok'">
              {{ summary?.conflict_count ? `${summary.conflict_count} 处` : '无' }}
            </span>
          </div>
          <div v-if="!summary?.conflict_count" class="d-empty" style="padding: 20px 10px">
            <strong>没有冲突</strong>
            同一间教室的课都没有时间重叠
          </div>
          <div v-else class="d-rows">
            <div
              v-for="c in summary.conflicts"
              :key="`${c.room}${c.date}`"
              class="d-row"
              style="cursor: pointer"
              @click="router.push(`/lessons/${c.lesson_ids[0]}`)"
            >
              <span class="d-dot" style="background: #ee0a24" />
              <div class="grow">
                <div class="title"><span class="clash-text">{{ c.room }}</span> · {{ c.date }}</div>
                <div class="meta">课时 #{{ c.lesson_ids.join('、#') }} 时间重叠</div>
              </div>
              <span class="d-badge danger">冲突</span>
            </div>
          </div>
        </div>

        <div class="d-card">
          <div class="d-card-title"><span>怎么看</span></div>
          <div class="muted" style="font-size: 12.5px; line-height: 1.9">
            每一行是一间教室，每一列是一天，格子里的时间段就是这间教室被占用的时候，空白即空闲。<br />
            同一间教室同一天时间重叠的课会被标红并写「冲突」，需要调课或换教室。
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.room-table { min-width: max-content; }
.room-table th.today { color: var(--van-primary-color); }
.room-cell { min-width: 108px; vertical-align: top; }
.room-cell.today { background: var(--eduhub-tint); }
.room-cell.clash { background: #fff5f6; }
.room-slot {
  display: flex; flex-direction: column; gap: 1px; margin-bottom: 5px; padding: 5px 8px;
  border: 1px solid var(--eduhub-line-2); border-radius: 8px; background: var(--eduhub-tint);
  font-size: 11.5px; line-height: 1.5; cursor: pointer;
}
.room-slot:last-child { margin-bottom: 0; }
.room-slot:hover { border-color: var(--eduhub-line-strong); }
.room-slot .t { color: var(--eduhub-text-2); font-variant-numeric: tabular-nums; }
.room-slot .n { color: var(--eduhub-text); font-weight: 600; }
.room-slot.bad { background: #ffecef; border-color: #f4c3c9; }
.room-slot.bad .t, .room-slot.bad .n { color: #c8172f; }
.clash-text { color: #d92b3f; font-weight: 600; }

html.dark .room-cell.today { background: var(--eduhub-tint); }
html.dark .room-cell.clash { background: var(--eduhub-danger-bg); }
html.dark .room-slot { background: var(--eduhub-tint); border-color: var(--eduhub-line); }
html.dark .room-slot.bad { background: var(--eduhub-danger-bg); border-color: rgba(255, 128, 147, 0.4); }
html.dark .room-slot.bad .t, html.dark .room-slot.bad .n,
html.dark .clash-text { color: var(--eduhub-danger-text); }
</style>
