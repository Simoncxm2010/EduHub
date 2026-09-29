<script setup>
import { computed, ref, watch } from 'vue';
import { showToast } from 'vant';
import api, { toastError } from '../../api';
import Modal from '../../ui/Modal.vue';
import { addDays, fmtDate } from '../../utils';
import { ensureHolidays, holidayOf } from '../../utils/holidays';

const props = defineProps({
  show: { type: Boolean, default: false },
  classes: { type: Array, default: () => [] },
  preset: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['update:show', 'created']);

const todayStr = fmtDate(new Date());
const form = ref({ class_id: null, date: todayStr, start_time: '18:00', duration_min: 90, room: '', topic: '', repeat_weeks: 1 });
const submitting = ref(false);
const conflict = ref('');

/** 所选日期的节假日提示（法定节假日 / 调休补班日） */
const holidayHint = computed(() => {
  if (!form.value.date) return '';
  const h = holidayOf(form.value.date);
  if (!h) return '';
  return h.type === 'workday' ? `${form.value.date} 为${h.name}调休补班日（需上班）` : `${form.value.date} 为${h.name}法定节假日`;
});

ensureHolidays();

const quickTimes = ['08:00', '09:00', '14:00', '16:00', '18:00', '18:30', '19:00', '19:30', '20:00'];
const quickDates = computed(() => [
  { text: '今天', value: todayStr },
  { text: '明天', value: addDays(todayStr, 1) },
  { text: '后天', value: addDays(todayStr, 2) },
  { text: '一周后', value: addDays(todayStr, 7) },
]);
/** 时长选项：拖拽框选出来的时长可能不在预设里，动态补进去免得下拉框空白 */
const durations = computed(() => {
  const base = [30, 40, 45, 60, 75, 90, 120, 180];
  const d = Number(props.preset?.duration_min);
  return Number.isFinite(d) && d > 0 && !base.includes(d) ? [...base, d].sort((a, b) => a - b) : base;
});

watch(() => props.show, (visible) => {
  if (!visible) return;
  conflict.value = '';
  const lastClass = Number(localStorage.getItem('eduhub_last_class')) || null;
  const picked = props.classes.find((c) => c.id === (props.preset?.class_id || lastClass)) || props.classes[0];
  form.value = {
    class_id: picked?.id ?? null,
    date: props.preset?.date || todayStr,
    start_time: props.preset?.start_time || localStorage.getItem('eduhub_last_time') || '18:00',
    duration_min: Number(props.preset?.duration_min) || 90,
    room: '',
    topic: '',
    repeat_weeks: 1,
  };
  check();
});

/** 实时冲突预检，让老师提交前就看到问题 */
async function check() {
  if (!form.value.class_id || !form.value.date || !form.value.start_time) return;
  try {
    const d = await api.get('/lessons/check', {
      params: {
        class_id: form.value.class_id,
        date: form.value.date,
        start_time: form.value.start_time,
        duration_min: form.value.duration_min,
        room: form.value.room,
      },
    });
    conflict.value = d.conflicts.length ? d.conflicts[0].text : '';
  } catch {
    conflict.value = '';
  }
}

async function submit() {
  const f = form.value;
  if (!f.class_id) return showToast('请选择班级');
  if (!f.date) return showToast('请选择日期');
  if (!f.start_time) return showToast('请选择时间');
  submitting.value = true;
  try {
    const d = await api.post('/lessons', { ...f });
    localStorage.setItem('eduhub_last_class', String(f.class_id));
    localStorage.setItem('eduhub_last_time', f.start_time);
    showToast({ type: 'success', message: `已排 ${d.lessons.length} 节课` });
    emit('created', d);
    emit('update:show', false);
  } catch (e) {
    toastError(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Modal
    :show="show"
    title="新建排课"
    :sub="preset?.start_time ? `已按你点选的时间预填 ${preset.start_time}` : '支持按周重复，一次排多节'"
    @update:show="emit('update:show', $event)"
  >
    <div class="d-form two">
      <div class="d-field">
        <label>班级 *</label>
        <select v-model.number="form.class_id" class="d-select" @change="check">
          <option v-for="c in classes" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>
      <div class="d-field">
        <label>日期 *</label>
        <input v-model="form.date" type="date" class="d-input" @change="check" />
      </div>
      <div class="d-field">
        <label>开始时间 *</label>
        <input v-model="form.start_time" type="time" class="d-input" @change="check" />
      </div>
      <div class="d-field">
        <label>时长</label>
        <select v-model.number="form.duration_min" class="d-select" @change="check">
          <option v-for="d in durations" :key="d" :value="d">{{ d }} 分钟</option>
        </select>
      </div>
      <div class="d-field">
        <label>教室</label>
        <input v-model="form.room" class="d-input" placeholder="如 301 教室，用于检测教室冲突" @blur="check" />
      </div>
      <div class="d-field">
        <label>每周重复</label>
        <select v-model.number="form.repeat_weeks" class="d-select">
          <option v-for="n in 16" :key="n" :value="n">{{ n === 1 ? '仅这一次' : `连续 ${n} 周` }}</option>
        </select>
      </div>
      <div class="d-field" style="grid-column: 1 / -1">
        <label>本节课主题</label>
        <input v-model="form.topic" class="d-input" placeholder="选填，如：牛顿第二定律应用" />
      </div>
    </div>

    <div class="d-inline" style="margin-top: 14px">
      <span class="meta" style="font-size: 12.5px; color: #98a1b5">快速选择：</span>
      <button v-for="q in quickDates" :key="q.value" class="d-btn sm" :class="form.date === q.value ? 'primary' : ''" @click="form.date = q.value; check()">
        {{ q.text }}
      </button>
      <span style="width: 8px" />
      <button v-for="t in quickTimes" :key="t" class="d-btn sm" :class="form.start_time === t ? 'primary' : ''" @click="form.start_time = t; check()">
        {{ t }}
      </button>
    </div>

    <div v-if="holidayHint" class="d-badge warn" style="margin-top: 14px; display: block; padding: 10px 12px">
      <van-icon name="flag-o" /> {{ holidayHint }}
    </div>

    <div v-if="conflict" class="d-badge warn" style="margin-top: 14px; display: block; padding: 10px 12px">
      该时段与「{{ conflict }}」重叠，确认创建时会再提示一次
    </div>

    <template #footer>
      <button class="d-btn" @click="emit('update:show', false)">取消</button>
      <button class="d-btn primary" :disabled="submitting" @click="submit">确认排课</button>
    </template>
  </Modal>
</template>
