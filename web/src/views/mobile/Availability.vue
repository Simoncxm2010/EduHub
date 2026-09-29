<script setup>
import { computed, onMounted, ref } from 'vue';
import { useBack } from '../../composables/back';
import { showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import AiRecognizeBox from '../../components/AiRecognizeBox.vue';
import WindowRuleFields from '../../components/WindowRuleFields.vue';
import { addDays, cnDate, fmtDate, WEEKDAY_SHORT } from '../../utils';

const back = useBack('/me');
const auth = useAuthStore();
const todayStr = fmtDate(new Date());
const DOW = [1, 2, 3, 4, 5, 6, 0];

const draft = ref([]);
const saving = ref(false);
const loading = ref(true);

const classes = ref([]);
const classId = ref(null);
const duration = ref(90);
const room = ref('');
const rangeFrom = ref(todayStr);
const rangeTo = ref(addDays(todayStr, 20));
const matching = ref(false);
const result = ref(null);

const showBook = ref(false);
const bookSlot = ref(null);
const bookReason = ref('');
const booking = ref(false);

function toMin(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}
function minToTime(m) {
  const v = Math.min(m, 1439);
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** 新时段的默认规则（高级项留空 = 不限制） */
function blankRule(weekday, start, end) {
  return {
    weekday, start_time: start, end_time: end, note: '',
    valid_from: null, valid_to: null, week_parity: 'all', specific_date: null,
    min_duration: 0, max_duration: 0,
  };
}

/** 只把服务端认识的字段发上去 */
function toRulePayload(w) {
  return {
    weekday: w.weekday,
    start_time: w.start_time,
    end_time: w.end_time,
    note: w.note || '',
    valid_from: w.valid_from || null,
    valid_to: w.valid_to || null,
    week_parity: w.week_parity || 'all',
    specific_date: w.specific_date || null,
    min_duration: Number(w.min_duration) || 0,
    max_duration: Number(w.max_duration) || 0,
  };
}

/**
 * 给草稿补 index。模板直接绑草稿对象（不能再 spread 副本，
 * 否则 v-model 写的是副本，保存时读到的还是旧值）。
 */
function reindex(arr) {
  arr.forEach((w, i) => { w.index = i; });
}

const grouped = computed(() => DOW.map((d) => ({
  weekday: d,
  items: draft.value.filter((w) => w.weekday === d),
})));

onMounted(async () => {
  try {
    const [av, cs] = await Promise.all([api.get('/availability'), api.get('/classes')]);
    draft.value = av.windows.map((w) => ({ ...w }));
    reindex(draft.value);
    gapMin.value = av.min_gap_min || 0;
    classes.value = cs.classes;
    if (cs.classes.length) classId.value = cs.classes[0].id;
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
});

function addWindow(weekday) {
  const sameDay = draft.value.filter((w) => w.weekday === weekday);
  const last = sameDay[sameDay.length - 1];
  draft.value.push(blankRule(
    weekday,
    last ? last.end_time : '18:00',
    minToTime(last ? toMin(last.end_time) + 120 : 21 * 60)
  ));
  reindex(draft.value);
}

function removeWindow(index) {
  draft.value.splice(index, 1);
  reindex(draft.value);
}

/* ---------------- 排课偏好：两节课之间的最短间隔 ---------------- */
const gapMin = ref(0);
const savingGap = ref(false);

async function saveGap() {
  savingGap.value = true;
  try {
    const d = await api.put('/availability/settings', { min_gap_min: Number(gapMin.value) || 0 });
    gapMin.value = d.min_gap_min;
    showToast({ type: 'success', message: d.min_gap_min ? `已设为 ${d.min_gap_min} 分钟` : '已取消间隔要求' });
  } catch (e) {
    toastError(e);
  } finally {
    savingGap.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    const d = await api.put('/availability', { windows: draft.value.map(toRulePayload) });
    draft.value = d.windows.map((w) => ({ ...w }));
    reindex(draft.value);
    showToast({ type: 'success', message: '已保存' });
    if (classId.value) match();
  } catch (e) {
    toastError(e);
  } finally {
    saving.value = false;
  }
}

async function match() {
  if (!classId.value) return showToast('请选择班级');
  matching.value = true;
  try {
    result.value = await api.get('/availability/match', {
      params: { class_id: classId.value, duration_min: duration.value, room: room.value, from: rangeFrom.value, to: rangeTo.value, limit: 30 },
    });
  } catch (e) {
    toastError(e);
  } finally {
    matching.value = false;
  }
}

async function createFromSlot(slot) {
  try {
    await api.post('/lessons', {
      class_id: classId.value, date: slot.date, start_time: slot.start_time,
      duration_min: slot.duration_min, room: room.value,
    });
    showToast({ type: 'success', message: '已排课' });
    match();
  } catch (e) {
    toastError(e);
  }
}

function openBook(slot) {
  bookSlot.value = slot;
  bookReason.value = '';
  showBook.value = true;
}

async function submitBook() {
  booking.value = true;
  try {
    const d = await api.post('/requests', {
      kind: 'booking', class_id: classId.value, date: bookSlot.value.date,
      start_time: bookSlot.value.start_time, duration_min: bookSlot.value.duration_min,
      room: room.value, reason: bookReason.value,
    });
    showToast({ type: 'success', message: d.conflict_note ? '已提交（含冲突提示）' : '预约申请已提交' });
    showBook.value = false;
    match();
  } catch (e) {
    toastError(e);
  } finally {
    booking.value = false;
  }
}

/* ---------------- 老师代学生填写时段 ---------------- */
const students = ref(null);
const loadingStudents = ref(false);
const showEditor = ref(false);
const editing = ref(null);
const editDraft = ref([]);
const editSaving = ref(false);

/** 两处「智能识别」输入框：我的时段 / 代填学生 */
const myAi = ref(null);
const stuAi = ref(null);

const editGrouped = computed(() => DOW.map((d) => ({
  weekday: d,
  items: editDraft.value.filter((w) => w.weekday === d),
})));

/** 识别结果只填草稿，仍要按保存才落库 */
function applyMyWindows(windows) {
  draft.value = windows.map((w) => ({ ...blankRule(w.weekday, w.start_time, w.end_time), note: w.note || '' }));
  reindex(draft.value);
}

function applyStuWindows(windows) {
  editDraft.value = windows.map((w) => ({ ...blankRule(w.weekday, w.start_time, w.end_time), note: w.note || '' }));
  reindex(editDraft.value);
}

async function loadStudents() {
  if (!classId.value) return showToast('请先选择班级');
  loadingStudents.value = true;
  try {
    const d = await api.get(`/availability/class/${classId.value}`);
    students.value = d.students;
  } catch (e) {
    toastError(e);
  } finally {
    loadingStudents.value = false;
  }
}

function openEditor(s) {
  editing.value = s;
  editDraft.value = s.windows.map((w) => ({ ...w }));
  reindex(editDraft.value);
  stuAi.value?.reset();
  showEditor.value = true;
}

function addEditWindow(weekday) {
  const sameDay = editDraft.value.filter((w) => w.weekday === weekday);
  const last = sameDay[sameDay.length - 1];
  editDraft.value.push(blankRule(
    weekday,
    last ? last.end_time : '18:00',
    minToTime(last ? toMin(last.end_time) + 120 : 21 * 60)
  ));
  reindex(editDraft.value);
}

function removeEditWindow(index) {
  editDraft.value.splice(index, 1);
  reindex(editDraft.value);
}

async function saveStudentWindows() {
  editSaving.value = true;
  try {
    await api.put(`/availability/student/${editing.value.student_id}`, {
      windows: editDraft.value.map(toRulePayload),
    });
    showToast({ type: 'success', message: '已保存' });
    showEditor.value = false;
    await loadStudents();
  } catch (e) {
    toastError(e);
  } finally {
    editSaving.value = false;
  }
}
</script>

<template>
  <div class="page">
    <van-nav-bar title="可上课时段" left-arrow @click-left="back()" />

    <div class="card">
      <div style="display: flex; align-items: center; justify-content: space-between">
        <div>
          <div style="font-size: 15px; font-weight: 600">我的每周时段</div>
          <div class="muted" style="margin-top: 3px">
            {{ auth.canTeach ? '你通常能授课的时间' : '你通常能上课的时间' }}
          </div>
        </div>
        <van-button size="small" round type="primary" :loading="saving" @click="save">保存</van-button>
      </div>

      <van-loading v-if="loading" style="margin: 20px auto" vertical>加载中…</van-loading>
      <template v-else>
        <div v-for="g in grouped" :key="g.weekday" class="aw-day">
          <div style="display: flex; align-items: center; justify-content: space-between">
            <span style="font-size: 13.5px; font-weight: 600">周{{ WEEKDAY_SHORT[g.weekday] }}</span>
            <van-button size="mini" plain round @click="addWindow(g.weekday)">+ 添加</van-button>
          </div>
          <div v-if="!g.items.length" class="muted" style="padding: 6px 0">未设置</div>
        <div v-for="w in g.items" :key="w.index" class="aw-item-wrap">
          <div class="aw-item">
            <input v-model="w.start_time" type="time" />
            <span class="muted">至</span>
            <input v-model="w.end_time" type="time" />
            <van-button size="mini" plain round type="danger" @click="removeWindow(w.index)">删</van-button>
          </div>
          <WindowRuleFields :rule="w" />
        </div>
        </div>
      </template>

      <!-- 学生也能用：把自己的口语描述直接转成上面的时段 -->
      <AiRecognizeBox
        ref="myAi"
        placeholder="说说你什么时候有空，例如：周二、周四晚上6点半到9点有空"
        @recognized="applyMyWindows"
      />
    </div>

    <div v-if="auth.canTeach" class="card">
      <div style="font-size: 15px; font-weight: 600; margin-bottom: 4px">排课偏好</div>
      <div class="muted" style="font-size: 12.5px; margin-bottom: 10px">
        两节课之间留出赶路 / 休息的时间，冲突检测与智能协调都会遵守
      </div>
      <div style="display: flex; align-items: center; gap: 10px">
        <input
          v-model.number="gapMin"
          type="number"
          min="0"
          max="240"
          step="5"
          placeholder="分钟"
          class="aw-num"
        />
        <span class="muted" style="font-size: 13px">分钟</span>
        <div style="flex: 1" />
        <van-button size="small" round type="primary" :loading="savingGap" @click="saveGap">保存</van-button>
      </div>
    </div>

    <div class="card">
      <div style="font-size: 15px; font-weight: 600; margin-bottom: 10px">智能协调时间</div>
      <van-cell-group inset>
        <van-field label="班级">
          <template #input>
            <select v-model.number="classId" class="d-select">
              <option v-for="c in classes" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </template>
        </van-field>
        <van-field v-model.number="duration" type="number" label="时长" placeholder="分钟" />
        <van-field label="起始日期">
          <template #input><input v-model="rangeFrom" type="date" class="d-input" /></template>
        </van-field>
        <van-field label="结束日期">
          <template #input><input v-model="rangeTo" type="date" class="d-input" /></template>
        </van-field>
        <van-field v-model="room" label="教室" placeholder="选填" />
      </van-cell-group>
      <div style="margin-top: 14px">
        <van-button round block type="primary" :loading="matching" @click="match">开始匹配</van-button>
      </div>
    </div>

    <!-- 学生时段：老师可以替没账号 / 不会填的学生代填 -->
    <div v-if="auth.canTeach" class="card">
      <div style="display: flex; align-items: center; justify-content: space-between">
        <div style="font-size: 15px; font-weight: 600">学生时段</div>
        <van-button size="mini" round :loading="loadingStudents" @click="loadStudents">
          {{ students ? '刷新' : '加载' }}
        </van-button>
      </div>
      <div v-if="!students" class="muted" style="margin-top: 8px">
        学生没账号或不会填时，可以替他填，填完就能参与智能协调
      </div>
      <div v-else style="margin-top: 8px">
        <div v-for="s in students" :key="s.student_id" class="stu-row">
          <div style="display: flex; align-items: center; gap: 6px">
            <span style="font-weight: 600; font-size: 14px">{{ s.name }}</span>
            <van-tag :type="s.filled_by_self ? 'success' : s.windows.length ? 'primary' : 'default'" plain>
              {{ s.filled_by_self ? '学生自填' : s.windows.length ? '老师代填' : '未填写' }}
            </van-tag>
            <div style="flex: 1" />
            <van-button size="mini" plain round @click="openEditor(s)">代填</van-button>
          </div>
          <div v-if="s.windows.length" class="muted" style="margin-top: 4px; font-size: 12px">
            {{ s.windows.map((w) => `周${WEEKDAY_SHORT[w.weekday]} ${w.start_time}-${w.end_time}`).join('、') }}
          </div>
        </div>
      </div>
    </div>

    <template v-if="result">
      <div class="section-head">
        <span>候选时段</span>
        <span class="muted">{{ result.students_with_windows }}/{{ result.total_students }} 位学生填过时段</span>
      </div>
      <div v-for="s in result.slots" :key="`${s.date}${s.start_time}`" class="card">
        <div style="display: flex; align-items: center; gap: 8px">
          <span style="font-weight: 600">{{ cnDate(s.date) }}</span>
          <span class="muted">{{ s.start_time }} - {{ s.end_time }}</span>
          <div style="flex: 1" />
          <van-tag :type="s.free_count === s.total_students ? 'success' : 'warning'">
            {{ s.free_count }}/{{ s.total_students }} 有空
          </van-tag>
        </div>
        <div v-if="s.busy_names.length" class="muted" style="margin-top: 6px">没空：{{ s.busy_names.join('、') }}</div>
        <div style="margin-top: 10px">
          <van-button v-if="auth.canTeach" size="small" round type="primary" @click="createFromSlot(s)">排这一节</van-button>
          <van-button v-else size="small" round type="primary" @click="openBook(s)">预约这个时段</van-button>
        </div>
      </div>
      <van-empty v-if="!result.slots.length" image="search" description="这段时间没有合适时段" />
    </template>

    <!-- 代填编辑器 -->
    <van-popup
      v-model:show="showEditor"
      round
      position="bottom"
      style="padding: 18px 16px 24px; max-height: 88vh; overflow-y: auto"
    >
      <div class="form-title">代填时段 · {{ editing?.name }}</div>
      <div class="muted" style="text-align: center; margin-bottom: 12px; font-size: 12.5px">
        {{ editing?.has_account ? '保存后写进该学生自己的时段，他可自行调整' : '该学生没有账号，时段由你代填' }}
      </div>
      <div v-if="editing?.filled_by_self" class="ai-note warn" style="margin-bottom: 10px">
        该学生自己填过时段，保存会覆盖他填写的内容
      </div>

      <div v-for="g in editGrouped" :key="g.weekday" class="aw-day">
        <div style="display: flex; align-items: center; justify-content: space-between">
          <span style="font-size: 13.5px; font-weight: 600">周{{ WEEKDAY_SHORT[g.weekday] }}</span>
          <van-button size="mini" plain round @click="addEditWindow(g.weekday)">+ 添加</van-button>
        </div>
        <div v-if="!g.items.length" class="muted" style="padding: 6px 0">未设置</div>
        <div v-for="w in g.items" :key="w.index" class="aw-item-wrap">
          <div class="aw-item">
            <input v-model="w.start_time" type="time" />
            <span class="muted">至</span>
            <input v-model="w.end_time" type="time" />
            <van-button size="mini" plain round type="danger" @click="removeEditWindow(w.index)">删</van-button>
          </div>
          <WindowRuleFields :rule="w" />
        </div>
      </div>

      <AiRecognizeBox
        ref="stuAi"
        placeholder="把学生的原话贴进来，例如：周二、周四晚上6点半到9点有空"
        @recognized="applyStuWindows"
      />

      <div style="margin-top: 16px; display: flex; gap: 10px">
        <van-button round block plain @click="editDraft = []">清空</van-button>
        <van-button round block type="primary" :loading="editSaving" @click="saveStudentWindows">保存</van-button>
      </div>
    </van-popup>

    <van-popup v-model:show="showBook" round position="bottom" style="padding: 18px 16px 24px">
      <div class="form-title">预约课程</div>
      <div v-if="bookSlot" class="muted" style="text-align: center; margin-bottom: 14px">
        {{ cnDate(bookSlot.date) }} {{ bookSlot.start_time }} - {{ bookSlot.end_time }}
      </div>
      <van-field v-model="bookReason" type="textarea" rows="3" autosize label="想上的内容" placeholder="如：上次请假落下的内容想补一下" />
      <div style="margin-top: 16px">
        <van-button round block type="primary" :loading="booking" @click="submitBook">提交预约申请</van-button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.aw-day { border-top: 1px solid #f1f3f8; padding: 10px 0; }
.aw-day:first-of-type { border-top: none; }
.aw-item { display: flex; align-items: center; gap: 8px; }
.aw-item-wrap { margin-top: 8px; }
.aw-item input { flex: 1; padding: 7px 10px; border: 1px solid #d9dfec; border-radius: 8px; font-family: inherit; font-size: 14px; }
.aw-num { width: 96px; padding: 7px 10px; border: 1px solid #d9dfec; border-radius: 8px; font-family: inherit; font-size: 14px; }
.stu-row { padding: 9px 0; border-top: 1px solid #f1f3f8; }
.stu-row:first-child { border-top: none; }
/* 智能识别框本体在 AiRecognizeBox 组件里，这里只留编辑器内的覆盖提示 */
.ai-note { font-size: 12.5px; padding: 7px 10px; border-radius: 8px; background: #eef2ff; color: #4a5470; }
.ai-note.warn { background: #fff7e8; color: #b26a00; }
</style>
