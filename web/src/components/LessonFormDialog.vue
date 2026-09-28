<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { showConfirmDialog, showToast } from 'vant';
import api, { toastError } from '../api';
import { isDesktop } from '../composables/layout';
import { addDays, fmtDate } from '../utils';

/** 新建单节课时：点击日历空档会带日期与时间进来，提交前先做冲突预检 */
const props = defineProps({
  show: { type: Boolean, default: false },
  classes: { type: Array, default: () => [] },
  preset: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['update:show', 'created']);

const todayStr = fmtDate(new Date());
const form = reactive({ class_id: null, class_name: '', date: '', start_time: '', duration_min: 90, room: '', topic: '', repeat_weeks: 1 });

const showClassPicker = ref(false);
const showTimePicker = ref(false);
const showDurPicker = ref(false);
const showCalendar = ref(false);
const submitting = ref(false);
const conflictHint = ref('');

const hourCol = Array.from({ length: 17 }, (_, i) => String(i + 6).padStart(2, '0'));
const minuteCol = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
const timeColumns = [{ values: [...hourCol] }, { values: [...minuteCol] }];
const durationOptions = [30, 40, 45, 60, 75, 90, 120, 180].map((v) => ({ text: `${v} 分钟`, value: v }));
const quickTimes = ['08:00', '09:00', '14:00', '16:00', '18:00', '18:30', '19:00', '19:30'];
const quickDates = computed(() => [
  { text: '今天', value: todayStr },
  { text: '明天', value: addDays(todayStr, 1) },
  { text: '后天', value: addDays(todayStr, 2) },
  { text: '下周同天', value: addDays(todayStr, 7) },
]);

watch(() => props.show, (visible) => {
  if (!visible) return;
  conflictHint.value = '';
  form.date = props.preset?.date || todayStr;
  form.start_time = props.preset?.start_time || localStorage.getItem('eduhub_last_time') || '18:00';
  const lastClass = Number(localStorage.getItem('eduhub_last_class')) || null;
  const picked = props.classes.find((c) => c.id === (props.preset?.class_id || lastClass)) || props.classes[0];
  form.class_id = picked?.id ?? null;
  form.class_name = picked?.name ?? '';
});

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

async function checkConflict() {
  if (!form.date || !form.start_time) return [];
  try {
    const d = await api.get('/lessons/check', {
      params: {
        class_id: form.class_id, date: form.date, start_time: form.start_time,
        duration_min: form.duration_min, room: form.room,
      },
    });
    conflictHint.value = d.conflicts.length ? `与「${d.conflicts[0].text}」重叠` : '';
    return d.conflicts;
  } catch {
    return [];
  }
}

async function submit() {
  if (!form.class_id) return showToast('请选择班级');
  if (!form.date) return showToast('请选择日期');
  if (!form.start_time) return showToast('请选择时间');
  submitting.value = true;
  try {
    const conflicts = await checkConflict();
    if (conflicts.length) {
      try {
        await showConfirmDialog({
          title: '时间冲突',
          message: `该时段与「${conflicts[0].text}」重叠，仍要创建吗？`,
          confirmButtonText: '仍然创建',
        });
      } catch {
        return;
      }
    }
    const d = await api.post('/lessons', { ...form });
    localStorage.setItem('eduhub_last_class', String(form.class_id));
    localStorage.setItem('eduhub_last_time', form.start_time);
    showToast(`已排 ${d.lessons.length} 节课`);
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
  <van-popup
    :show="show"
    round
    class="eduhub-popup"
    :position="isDesktop ? 'center' : 'bottom'"
    style="padding: 18px 4px 24px; max-height: 90vh; overflow-y: auto"
    @update:show="emit('update:show', $event)"
  >
    <div class="form-title">新建排课</div>
    <van-cell-group inset>
      <van-field :model-value="form.class_name" label="班级" placeholder="选择班级" readonly is-link @click="showClassPicker = true" />
      <van-field :model-value="form.date" label="日期" placeholder="选择日期" readonly is-link @click="showCalendar = true" />
    </van-cell-group>

    <div class="quick-row">
      <span
        v-for="q in quickDates"
        :key="q.value"
        class="chip chip-sm"
        :class="{ on: form.date === q.value }"
        @click="form.date = q.value"
      >{{ q.text }}</span>
    </div>

    <van-cell-group inset>
      <van-field :model-value="form.start_time" label="开始时间" placeholder="选择时间" readonly is-link @click="showTimePicker = true" />
    </van-cell-group>

    <div class="quick-row">
      <span
        v-for="t in quickTimes"
        :key="t"
        class="chip chip-sm"
        :class="{ on: form.start_time === t }"
        @click="form.start_time = t"
      >{{ t }}</span>
    </div>

    <van-cell-group inset>
      <van-field
        :model-value="form.duration_min ? form.duration_min + ' 分钟' : ''"
        label="时长" placeholder="选择时长" readonly is-link @click="showDurPicker = true"
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

    <div v-if="conflictHint" class="conflict-hint">
      <van-icon name="warning-o" /> {{ conflictHint }}
    </div>

    <div style="margin: 16px">
      <van-button round block type="primary" :loading="submitting" @click="submit">确认排课</van-button>
    </div>

    <van-popup v-model:show="showClassPicker" round position="bottom">
      <van-picker :columns="classes.map((c) => ({ text: c.name, value: c.id }))" @confirm="pickClass" @cancel="showClassPicker = false" />
    </van-popup>

    <van-popup v-model:show="showTimePicker" round position="bottom">
      <van-picker title="选择时间" :columns="timeColumns" :model-value="[form.start_time?.slice(0, 2), form.start_time?.slice(3, 5)]" @confirm="pickTime" @cancel="showTimePicker = false" />
    </van-popup>

    <van-popup v-model:show="showDurPicker" round position="bottom">
      <van-picker title="选择时长" :columns="durationOptions" @confirm="pickDuration" @cancel="showDurPicker = false" />
    </van-popup>

    <van-calendar v-model:show="showCalendar" :min-date="new Date(2020, 0, 1)" :max-date="new Date(2032, 11, 31)" @confirm="pickDate" />
  </van-popup>
</template>
