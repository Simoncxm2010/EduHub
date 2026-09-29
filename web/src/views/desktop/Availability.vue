<script setup>
import { computed, onMounted, ref } from 'vue';
import { showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import Modal from '../../ui/Modal.vue';
import AiRecognizeBox from '../../components/AiRecognizeBox.vue';
import { addDays, cnDate, fmtDate, WEEKDAY_SHORT } from '../../utils';

const auth = useAuthStore();
const todayStr = fmtDate(new Date());

/* ---------------- 我的时段 ---------------- */
const windows = ref([]);
const draft = ref([]);
const saving = ref(false);
const loading = ref(true);

const DOW = [1, 2, 3, 4, 5, 6, 0];

async function load() {
  loading.value = true;
  try {
    const d = await api.get('/availability');
    windows.value = d.windows;
    draft.value = d.windows.map((w) => ({ ...w }));
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  await load();
  await loadClasses();
});

function addWindow(weekday) {
  const sameDay = draft.value.filter((w) => w.weekday === weekday);
  const last = sameDay[sameDay.length - 1];
  const start = last ? last.end_time : '18:00';
  const end = last ? minToTimeSafe(toMinSafe(last.end_time) + 120) : '21:00';
  draft.value.push({ weekday, start_time: start, end_time: end });
}

function minToTimeSafe(m) {
  const v = Math.min(m, 1439);
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}
function toMinSafe(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

function removeWindow(index) {
  draft.value.splice(index, 1);
}

function copyToAllDays() {
  const src = draft.value.filter((w) => w.weekday === draft.value[0]?.weekday);
  if (!src.length) return showToast('先在某一天添加一个时段');
  const out = [];
  for (const d of DOW) for (const w of src) out.push({ weekday: d, start_time: w.start_time, end_time: w.end_time });
  draft.value = out;
}

async function save() {
  saving.value = true;
  try {
    const d = await api.put('/availability', {
      windows: draft.value.map((w) => ({ weekday: w.weekday, start_time: w.start_time, end_time: w.end_time })),
    });
    windows.value = d.windows;
    draft.value = d.windows.map((w) => ({ ...w }));
    showToast({ type: 'success', message: '时段已保存' });
    if (selectedClassId.value) match();
  } catch (e) {
    toastError(e);
  } finally {
    saving.value = false;
  }
}

const grouped = computed(() => DOW.map((d) => ({
  weekday: d,
  items: draft.value.map((w, i) => ({ ...w, index: i })).filter((w) => w.weekday === d),
})));

/* ---------------- 智能协调 ---------------- */
const classes = ref([]);
const selectedClassId = ref(null);
const duration = ref(90);
const room = ref('');
const rangeFrom = ref(todayStr);
const rangeTo = ref(addDays(todayStr, 20));
const ignoreTeacher = ref(false);
const matching = ref(false);
const result = ref(null);

async function loadClasses() {
  try {
    const d = await api.get('/classes');
    classes.value = d.classes;
    if (!selectedClassId.value && d.classes.length) selectedClassId.value = d.classes[0].id;
  } catch (e) {
    toastError(e);
  }
}

async function match() {
  if (!selectedClassId.value) return showToast('请选择班级');
  matching.value = true;
  try {
    result.value = await api.get('/availability/match', {
      params: {
        class_id: selectedClassId.value,
        duration_min: duration.value,
        room: room.value,
        from: rangeFrom.value,
        to: rangeTo.value,
        limit: 40,
        ignore_teacher_availability: ignoreTeacher.value ? 1 : 0,
      },
    });
  } catch (e) {
    toastError(e);
  } finally {
    matching.value = false;
  }
}

/** 从候选时段一键排课 */
const creating = ref(null);
async function createFromSlot(slot) {
  creating.value = `${slot.date}${slot.start_time}`;
  try {
    await api.post('/lessons', {
      class_id: selectedClassId.value,
      date: slot.date,
      start_time: slot.start_time,
      duration_min: slot.duration_min,
      room: room.value,
    });
    showToast({ type: 'success', message: `已排课 ${slot.date} ${slot.start_time}` });
    await match();
  } catch (e) {
    toastError(e);
  } finally {
    creating.value = null;
  }
}

/** 学生：发起预约 */
const showBook = ref(false);
const bookSlot = ref(null);
const bookReason = ref('');
const booking = ref(false);

function openBook(slot) {
  bookSlot.value = slot;
  bookReason.value = '';
  showBook.value = true;
}

async function submitBook() {
  booking.value = true;
  try {
    const d = await api.post('/requests', {
      kind: 'booking',
      class_id: selectedClassId.value,
      date: bookSlot.value.date,
      start_time: bookSlot.value.start_time,
      duration_min: bookSlot.value.duration_min,
      room: room.value,
      reason: bookReason.value,
    });
    showToast({
      type: 'success',
      message: d.conflict_note ? '已提交，老师会看到时段冲突提示' : '预约申请已提交',
    });
    showBook.value = false;
    match();
  } catch (e) {
    toastError(e);
  } finally {
    booking.value = false;
  }
}

/* ---------------- 教师查看学生时段 ---------------- */
const studentWindows = ref(null);
const loadingStudents = ref(false);

async function loadStudentWindows() {
  if (!selectedClassId.value) return;
  loadingStudents.value = true;
  try {
    const d = await api.get(`/availability/class/${selectedClassId.value}`);
    studentWindows.value = d.students;
  } catch (e) {
    toastError(e);
  } finally {
    loadingStudents.value = false;
  }
}

function isFree(windows, weekday, startMin, endMin) {
  return windows.some((w) => w.weekday === weekday && toMinSafe(w.start_time) <= startMin && toMinSafe(w.end_time) >= endMin);
}

/* ---------------- 老师代学生填写时段 ---------------- */
const showEditor = ref(false);
const editing = ref(null);
const editDraft = ref([]);
const editSaving = ref(false);

/** 两处「智能识别」输入框：我的时段 / 代填学生 */
const myAi = ref(null);
const stuAi = ref(null);

const editGrouped = computed(() => DOW.map((d) => ({
  weekday: d,
  items: editDraft.value.map((w, i) => ({ ...w, index: i })).filter((w) => w.weekday === d),
})));

/** 识别结果只填草稿，仍要点保存才落库 */
function applyMyWindows(windows) {
  draft.value = windows.map((w) => ({ weekday: w.weekday, start_time: w.start_time, end_time: w.end_time }));
}

function applyStuWindows(windows) {
  editDraft.value = windows.map((w) => ({ weekday: w.weekday, start_time: w.start_time, end_time: w.end_time }));
}

function openEditor(s) {
  editing.value = s;
  editDraft.value = s.windows.map((w) => ({ weekday: w.weekday, start_time: w.start_time, end_time: w.end_time }));
  stuAi.value?.reset();
  showEditor.value = true;
}

function addEditWindow(weekday) {
  const sameDay = editDraft.value.filter((w) => w.weekday === weekday);
  const last = sameDay[sameDay.length - 1];
  editDraft.value.push({
    weekday,
    start_time: last ? last.end_time : '18:00',
    end_time: minToTimeSafe(last ? toMinSafe(last.end_time) + 120 : 21 * 60),
  });
}

async function saveStudentWindows() {
  editSaving.value = true;
  try {
    await api.put(`/availability/student/${editing.value.student_id}`, {
      windows: editDraft.value.map((w) => ({ weekday: w.weekday, start_time: w.start_time, end_time: w.end_time })),
    });
    showToast({ type: 'success', message: `已保存 ${editing.value.name} 的时段` });
    showEditor.value = false;
    await loadStudentWindows();
    if (selectedClassId.value) match();
  } catch (e) {
    toastError(e);
  } finally {
    editSaving.value = false;
  }
}
</script>

<template>
  <div class="d-page">
    <div class="d-head">
      <div>
        <h1>可上课时段与智能协调</h1>
        <div class="sub">
          {{ auth.canTeach ? '设置你能授课的时间，系统会找出全班都有空、且没有排课冲突的时段' : '填写你能上课的时间，老师排课时就能避开你的忙碌时段' }}
        </div>
      </div>
      <div class="d-head-actions">
        <button class="d-btn" :disabled="saving" @click="save">保存我的时段</button>
      </div>
    </div>

    <div class="d-split">
      <!-- 左：时段编辑 + 匹配结果 -->
      <div class="d-col">
        <div class="d-card">
          <div class="d-card-title">
            <span>我的每周可上课时段</span>
            <button class="d-btn sm ghost" @click="copyToAllDays">把周一的时段复制到全周</button>
          </div>
          <div v-if="loading" class="d-empty">加载中…</div>
          <div v-else class="aw-grid">
            <div v-for="g in grouped" :key="g.weekday" class="aw-day">
              <div class="aw-day-head">
                <span>周{{ WEEKDAY_SHORT[g.weekday] }}</span>
                <button class="d-btn sm ghost" @click="addWindow(g.weekday)">+ 添加</button>
              </div>
              <div v-if="!g.items.length" class="aw-none">未设置</div>
              <div v-for="w in g.items" :key="w.index" class="aw-item">
                <input v-model="w.start_time" type="time" class="d-input" style="width: 108px" />
                <span style="color: #98a1b5">–</span>
                <input v-model="w.end_time" type="time" class="d-input" style="width: 108px" />
                <button class="d-btn sm danger" @click="removeWindow(w.index)">删</button>
              </div>
            </div>
          </div>

          <!-- 学生也能用：把自己的口语描述直接转成上面的时段 -->
          <AiRecognizeBox
            ref="myAi"
            :placeholder="auth.canTeach
              ? '说说你什么时候能上课，例如：周二、周四晚上6点半到9点有空'
              : '说说你什么时候有空，例如：周二、周四晚上6点半到9点有空，周六上午9点到11点也行'"
            @recognized="applyMyWindows"
          />
        </div>

        <div class="d-card">
          <div class="d-card-title">
            <span>智能协调时间</span>
            <span class="d-badge mute">按半小时粒度匹配</span>
          </div>

          <div class="d-form" style="grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 14px">
            <div class="d-field">
              <label>班级</label>
              <select v-model.number="selectedClassId" class="d-select">
                <option v-for="c in classes" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>
            <div class="d-field">
              <label>单节时长（分钟）</label>
              <input v-model.number="duration" type="number" min="15" max="480" step="15" class="d-input" />
            </div>
            <div class="d-field">
              <label>起始日期</label>
              <input v-model="rangeFrom" type="date" class="d-input" />
            </div>
            <div class="d-field">
              <label>结束日期</label>
              <input v-model="rangeTo" type="date" class="d-input" />
            </div>
            <div class="d-field">
              <label>教室（检测占用）</label>
              <input v-model="room" class="d-input" placeholder="选填" />
            </div>
            <div class="d-field" style="justify-content: flex-end">
              <label class="d-check">
                <input v-model="ignoreTeacher" type="checkbox" />
                忽略我的可授课时段（按 08:00–22:00）
              </label>
            </div>
            <div class="d-field" style="justify-content: flex-end">
              <button class="d-btn primary" :disabled="matching" @click="match">
                {{ matching ? '匹配中…' : '开始匹配' }}
              </button>
            </div>
          </div>

          <div v-if="result" class="d-inline" style="margin-bottom: 12px">
            <span class="d-badge info">共找到 {{ result.total_slots }} 个候选时段</span>
            <span class="d-badge" :class="result.students_with_windows ? 'ok' : 'warn'">
              {{ result.students_with_windows }}/{{ result.total_students }} 位学生填写过时段
            </span>
            <span v-if="!result.students_with_windows" class="sub" style="font-size: 12.5px; color: #98a1b5">
              还没有学生填写时段，匹配结果仅按你的空档计算
            </span>
          </div>

          <div v-if="result && !result.slots.length" class="d-empty">
            <strong>这段时间没有合适的时段</strong>
            试着放宽日期范围，或检查你的可授课时段设置
          </div>

          <div v-else-if="result" class="d-scroll" style="max-height: 420px">
            <table class="d-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>时间</th>
                  <th class="center">有空学生</th>
                  <th>谁没空</th>
                  <th class="actions">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in result.slots" :key="`${s.date}${s.start_time}`">
                  <td class="strong">{{ cnDate(s.date) }}</td>
                  <td>{{ s.start_time }} - {{ s.end_time }}</td>
                  <td class="center">
                    <span class="d-badge" :class="s.free_count === s.total_students ? 'ok' : s.free_count ? 'warn' : 'danger'">
                      {{ s.free_count }}/{{ s.total_students }}
                    </span>
                  </td>
                  <td style="font-size: 12.5px; color: #98a1b5">{{ s.busy_names.join('、') || '全部有空' }}</td>
                  <td class="actions">
                    <button v-if="auth.canTeach" class="d-btn sm primary" :disabled="creating === `${s.date}${s.start_time}`" @click="createFromSlot(s)">
                      排这一节
                    </button>
                    <button v-else class="d-btn sm primary" @click="openBook(s)">预约这个时段</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 右：学生时段一览 -->
      <div class="d-col">
        <div v-if="auth.canTeach" class="d-card">
          <div class="d-card-title">
            <span>学生时段一览</span>
            <button class="d-btn sm" :disabled="loadingStudents" @click="loadStudentWindows">
              {{ studentWindows ? '刷新' : '查看' }}
            </button>
          </div>
          <div v-if="!studentWindows" class="d-empty" style="padding: 22px 10px">
            <strong>点「查看」加载</strong>
            了解学生什么时候有空；学生没账号或不会填时，可以替他填
          </div>
          <div v-else class="sw-list">
            <div v-for="s in studentWindows" :key="s.student_id" class="sw-row">
              <div class="sw-head">
                <span class="sw-name">{{ s.name }}</span>
                <span class="d-badge" :class="s.filled_by_self ? 'ok' : s.windows.length ? 'info' : 'mute'">
                  {{ s.filled_by_self ? '学生自填' : s.windows.length ? '老师代填' : '未填写' }}
                </span>
                <span v-if="!s.has_account" class="d-badge mute">无账号</span>
                <div style="flex: 1" />
                <button class="d-btn sm" @click="openEditor(s)">代填 / 编辑</button>
              </div>
              <div v-if="!s.windows.length" class="sw-empty">还没有时段</div>
              <div v-else class="sw-badges">
                <span v-for="w in s.windows" :key="`${w.weekday}${w.start_time}`" class="d-badge info">
                  周{{ WEEKDAY_SHORT[w.weekday] }} {{ w.start_time }}-{{ w.end_time }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div class="d-card">
          <div class="d-card-title"><span>怎么用</span></div>
          <div class="d-list-hint">
            <p><b>1. 先填时段。</b>老师填「能授课的时间」，学生填「能上课的时间」，一周内的都可以。</p>
            <p><b>2. 再点开始匹配。</b>系统会把老师的空档、学生的空档、已有排课三者取交集，按「有空人数」从多到少列出来。</p>
            <p><b>3. 一键排课或预约。</b>老师可以直接把候选时段排成课；学生可以据此发起预约，等老师审批。</p>
            <p class="muted">没有学生填写时段时，结果只反映老师的空档，仍可用于排课。</p>
          </div>
        </div>
      </div>
    </div>

    <Modal
      v-model:show="showEditor"
      :title="editing ? `代填时段 · ${editing.name}` : '代填时段'"
      :sub="editing && !editing.has_account ? '该学生没有账号，时段由你代填' : '保存后会写进该学生自己的时段，他可自行调整'"
      wide
      @update:show="showEditor = $event"
    >
      <div v-if="editing?.filled_by_self" class="ai-note warn">
        <van-icon name="warning-o" /> 该学生自己填过时段，保存会覆盖他填写的内容
      </div>

      <div class="aw-grid" style="margin-top: 4px">
        <div v-for="g in editGrouped" :key="g.weekday" class="aw-day">
          <div class="aw-day-head">
            <span>周{{ WEEKDAY_SHORT[g.weekday] }}</span>
            <button class="d-btn sm ghost" @click="addEditWindow(g.weekday)">+ 添加</button>
          </div>
          <div v-if="!g.items.length" class="aw-none">未设置</div>
          <div v-for="w in g.items" :key="w.index" class="aw-item">
            <input v-model="w.start_time" type="time" class="d-input" style="width: 108px" />
            <span style="color: #98a1b5">–</span>
            <input v-model="w.end_time" type="time" class="d-input" style="width: 108px" />
            <button class="d-btn sm danger" @click="editDraft.splice(w.index, 1)">删</button>
          </div>
        </div>
      </div>

      <!-- 智能识别：把学生的原话/截图直接转成上面的时段 -->
      <AiRecognizeBox
        ref="stuAi"
        placeholder="把学生的原话贴进来，例如：周二、周四晚上6点半到9点有空，周六上午9点到11点也行"
        @recognized="applyStuWindows"
      />

      <template #footer>
        <button class="d-btn" @click="showEditor = false">取消</button>
        <button class="d-btn danger" @click="editDraft = []">清空</button>
        <button class="d-btn primary" :disabled="editSaving" @click="saveStudentWindows">
          {{ editSaving ? '保存中…' : '保存该学生时段' }}
        </button>
      </template>
    </Modal>

    <Modal v-model:show="showBook" title="预约课程" :sub="bookSlot ? `${cnDate(bookSlot.date)} ${bookSlot.start_time} - ${bookSlot.end_time}` : ''" size="narrow" @update:show="showBook = $event">
      <div class="d-field">
        <label>预约原因 / 想上的内容</label>
        <textarea v-model="bookReason" class="d-textarea" style="min-height: 90px" placeholder="如：上次请假落下的内容想补一下" />
      </div>
      <template #footer>
        <button class="d-btn" @click="showBook = false">取消</button>
        <button class="d-btn primary" :disabled="booking" @click="submitBook">提交预约申请</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.aw-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 20px; }
.aw-day { border: 1px solid #f0f2f8; border-radius: 10px; padding: 10px 12px; }
.aw-day-head { display: flex; align-items: center; justify-content: space-between; font-size: 13.5px; font-weight: 600; margin-bottom: 8px; }
.aw-none { font-size: 12.5px; color: #b6bdcc; padding: 4px 0; }
.aw-item { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.sw-list { display: flex; flex-direction: column; }
.sw-row { padding: 10px 0; border-bottom: 1px solid #f1f3f9; }
.sw-row:last-child { border-bottom: none; }
.sw-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.sw-name { font-size: 13.5px; font-weight: 600; }
.sw-empty { font-size: 12.5px; color: #b6bdcc; }
.sw-badges { display: flex; gap: 6px; flex-wrap: wrap; }
.d-list-hint p { font-size: 13px; line-height: 1.75; color: #4a5470; margin: 0 0 10px; }
.d-list-hint p:last-child { margin-bottom: 0; }

/* 智能识别框本体在 AiRecognizeBox 组件里，这里只留编辑器内的覆盖提示 */
.ai-note { font-size: 12.5px; color: #4a5470; padding: 7px 10px; border-radius: 8px; background: #eef2ff; }
.ai-note.warn { background: #fff7e8; color: #b26a00; margin-bottom: 10px; }
</style>
