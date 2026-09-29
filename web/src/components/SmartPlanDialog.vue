<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { showToast } from 'vant';
import api, { toastError } from '../api';
import { isDesktop } from '../composables/layout';
import { addDays, cnDate, fmtDate, WEEKDAY_SHORT } from '../utils';

/**
 * 智能排课：按「每周哪几天 + 时间 + 日期范围」批量生成课时。
 * 生成前先预览，自动标出与已有课程冲突或老师手动排除的日期，只创建可排的那些。
 */
const props = defineProps({
  show: { type: Boolean, default: false },
  classes: { type: Array, default: () => [] },
});
const emit = defineEmits(['update:show', 'created']);

const todayStr = fmtDate(new Date());
const step = ref('form');
const form = reactive({
  class_id: null, class_name: '', weekdays: [], start_time: '18:30',
  duration_min: 90, room: '', topic: '', from: todayStr, to: addDays(todayStr, 55),
});
const skipDates = ref([]);
/** 手动恢复的日期（可覆盖节假日默认跳过） */
const includeDates = ref([]);
/** 法定节假日不排课（调休补班日照常排） */
const skipHolidays = ref(true);
const plan = ref([]);
const summary = ref({ total: 0, ok: 0, conflict: 0, skip: 0, holiday: 0 });
const suggestion = ref(null);
const loading = ref(false);
const creating = ref(false);

const showClassPicker = ref(false);
const showTimePicker = ref(false);
const showDurPicker = ref(false);
const showRange = ref(false);
const range = ref([]);

const hourCol = Array.from({ length: 17 }, (_, i) => String(i + 6).padStart(2, '0'));
const minuteCol = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
const timeColumns = [{ values: [...hourCol] }, { values: [...minuteCol] }];
const durationOptions = [30, 40, 45, 60, 75, 90, 120, 180].map((v) => ({ text: `${v} 分钟`, value: v }));
const dowOptions = [1, 2, 3, 4, 5, 6, 0];

const rangeLabel = computed(() => `${form.from} 至 ${form.to}`);
const canPreview = computed(() => form.class_id && form.weekdays.length);

watch(() => props.show, (visible) => {
  if (!visible) return;
  step.value = 'form';
  plan.value = [];
  skipDates.value = [];
  includeDates.value = [];
  skipHolidays.value = true;
  suggestion.value = null;
  form.from = todayStr;
  form.to = addDays(todayStr, 55);
  const lastClass = Number(localStorage.getItem('eduhub_last_class')) || null;
  const picked = props.classes.find((c) => c.id === lastClass) || props.classes[0];
  form.class_id = picked?.id ?? null;
  form.class_name = picked?.name ?? '';
  if (form.class_id) loadSuggestion();
});

function pickClass({ selectedOptions }) {
  form.class_id = selectedOptions[0]?.value;
  form.class_name = selectedOptions[0]?.text;
  showClassPicker.value = false;
  loadSuggestion();
}

function pickTime({ selectedValues }) {
  form.start_time = `${selectedValues[0]}:${selectedValues[1]}`;
  showTimePicker.value = false;
}

function pickDuration({ selectedOptions }) {
  form.duration_min = selectedOptions[0]?.value;
  showDurPicker.value = false;
}

function onRange(dates) {
  if (Array.isArray(dates) && dates.length === 2) {
    form.from = fmtDate(dates[0]);
    form.to = fmtDate(dates[1]);
  }
  showRange.value = false;
}

function toggleWeekday(d) {
  const i = form.weekdays.indexOf(d);
  if (i >= 0) form.weekdays.splice(i, 1);
  else form.weekdays.push(d);
}

/** 按该班历史排课规律预填表单 */
async function loadSuggestion() {
  if (!form.class_id) return;
  try {
    const d = await api.get('/lessons/smart/suggest', { params: { class_id: form.class_id } });
    suggestion.value = d.suggestion;
    if (!d.suggestion) return;
    form.weekdays = [...d.suggestion.weekdays];
    form.start_time = d.suggestion.start_time;
    form.duration_min = d.suggestion.duration_min;
    form.room = d.suggestion.room || '';
  } catch {
    suggestion.value = null;
  }
}

async function preview() {
  if (!canPreview.value) return showToast('请选择班级和每周上课的日子');
  if (!form.weekdays.length) return showToast('请选择每周上课的日子');
  loading.value = true;
  try {
    const d = await api.post('/lessons/smart/plan', {
      class_id: form.class_id,
      weekdays: form.weekdays,
      start_time: form.start_time,
      duration_min: form.duration_min,
      room: form.room,
      topic: form.topic,
      from: form.from,
      to: form.to,
      skip_dates: skipDates.value,
      include_dates: includeDates.value,
      skip_holidays: skipHolidays.value,
      dry_run: true,
    });
    plan.value = d.plan;
    summary.value = d.summary;
    step.value = 'preview';
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

/** 点某一行的日期可以排除 / 恢复；节假日默认跳过，点一下改成照常排课 */
async function toggleSkip(row) {
  if (row.status === 'conflict') return;
  if (row.excluded) {
    const i = skipDates.value.indexOf(row.date);
    if (i >= 0) skipDates.value.splice(i, 1);
  } else if (row.included) {
    const i = includeDates.value.indexOf(row.date);
    if (i >= 0) includeDates.value.splice(i, 1);
  } else if (row.holiday?.type === 'holiday') {
    includeDates.value.push(row.date);
  } else {
    skipDates.value.push(row.date);
  }
  await preview();
}

async function create() {
  if (!summary.value.ok) return showToast('没有可排的课时');
  creating.value = true;
  try {
    const d = await api.post('/lessons/smart/plan', {
      class_id: form.class_id,
      weekdays: form.weekdays,
      start_time: form.start_time,
      duration_min: form.duration_min,
      room: form.room,
      topic: form.topic,
      from: form.from,
      to: form.to,
      skip_dates: skipDates.value,
      include_dates: includeDates.value,
      skip_holidays: skipHolidays.value,
      dry_run: false,
    });
    localStorage.setItem('eduhub_last_class', String(form.class_id));
    showToast({ type: 'success', message: `已创建 ${d.created.length} 节课` });
    emit('created', d);
    emit('update:show', false);
  } catch (e) {
    toastError(e);
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <van-popup
    :show="show"
    round
    class="eduhub-popup eduhub-popup-wide"
    :position="isDesktop ? 'center' : 'bottom'"
    style="padding: 18px 0 22px; max-height: 90vh; display: flex; flex-direction: column"
    @update:show="emit('update:show', $event)"
  >
    <div class="form-title">
      <van-icon name="bulb-o" /> 智能排课
      <span v-if="step === 'preview'" class="muted" style="font-weight: 400; margin-left: 8px">第 2 步 / 确认计划</span>
      <span v-else class="muted" style="font-weight: 400; margin-left: 8px">第 1 步 / 设置规律</span>
    </div>

    <div style="flex: 1; overflow-y: auto; min-height: 0">
      <!-- 第一步：设置排课规律 -->
      <template v-if="step === 'form'">
        <div v-if="suggestion" class="smart-tip">
          <van-icon name="bulb-o" />
          参考该班近 {{ suggestion.sampled }} 节课：通常
          {{ suggestion.weekdays.map((d) => '周' + WEEKDAY_SHORT[d]).join('、') }}
          {{ suggestion.start_time }} 上 {{ suggestion.duration_min }} 分钟{{ suggestion.room ? `，教室 ${suggestion.room}` : '' }}
        </div>

        <van-cell-group inset>
          <van-field :model-value="form.class_name" label="班级" placeholder="选择班级" readonly is-link @click="showClassPicker = true" />
          <van-field label="每周上课">
            <template #input>
              <div class="dow-row">
                <span
                  v-for="d in dowOptions"
                  :key="d"
                  class="chip chip-sm"
                  :class="{ on: form.weekdays.includes(d) }"
                  @click="toggleWeekday(d)"
                >{{ WEEKDAY_SHORT[d] }}</span>
              </div>
            </template>
          </van-field>
          <van-field :model-value="form.start_time" label="上课时间" readonly is-link @click="showTimePicker = true" />
          <van-field
            :model-value="`${form.duration_min} 分钟`" label="时长" readonly is-link @click="showDurPicker = true"
          />
          <van-field v-model="form.room" label="教室" placeholder="选填，用于检测教室冲突" />
          <van-field v-model="form.topic" label="主题" placeholder="选填，会写入每节课" />
          <van-field :model-value="rangeLabel" label="日期范围" readonly is-link @click="showRange = true" />
          <van-cell center title="法定节假日不排课" :label="skipHolidays ? '假期自动跳过（补班日照常）' : '节假日也照常排课'">
            <template #right-icon>
              <van-switch v-model="skipHolidays" size="20" />
            </template>
          </van-cell>
        </van-cell-group>
        <div class="muted" style="margin: 10px 20px 0">
          生成时会自动跳过法定节假日、与该班已有课程冲突、或同一教室被其他课程占用的日期。
        </div>
      </template>

      <!-- 第二步：预览与确认 -->
      <template v-else>
        <div class="smart-summary">
          <div><b>{{ summary.total }}</b><span>个候选日期</span></div>
          <div class="ok"><b>{{ summary.ok }}</b><span>可排</span></div>
          <div class="holiday"><b>{{ summary.holiday || 0 }}</b><span>节假日跳过</span></div>
          <div class="conflict"><b>{{ summary.conflict }}</b><span>冲突跳过</span></div>
          <div class="skip"><b>{{ summary.skip - (summary.holiday || 0) }}</b><span>手动排除</span></div>
        </div>
        <div class="muted" style="margin: 6px 18px 10px">
          每周 {{ form.weekdays.map((d) => '周' + WEEKDAY_SHORT[d]).join('、') }} ·
          {{ form.start_time }} · {{ form.duration_min }} 分钟{{ form.room ? ` · ${form.room}` : '' }}
        </div>

        <div class="smart-plan">
          <div
            v-for="row in plan"
            :key="row.date"
            class="plan-row"
            :class="row.status"
            @click="toggleSkip(row)"
          >
            <van-icon
              :name="row.status === 'ok' ? 'passed' : row.status === 'conflict' ? 'warning-o' : 'close'"
              :color="row.status === 'ok' ? '#07c160' : row.status === 'conflict' ? '#ff976a' : '#c3c9d6'"
              size="16"
            />
            <div class="plan-date">
              <b>{{ cnDate(row.date) }}</b>
              <span
                v-if="row.holiday"
                class="plan-hol"
                :class="row.holiday.type"
                :title="row.holiday.type === 'workday' ? `${row.holiday.name}调休补班日` : `${row.holiday.name}法定节假日`"
              >{{ row.holiday.type === 'workday' ? '班' : '休' }}</span>
              <span v-if="row.reason" class="muted">{{ row.reason }}</span>
            </div>
            <van-tag v-if="row.status === 'ok'" plain type="success">可排</van-tag>
            <van-tag v-else-if="row.status === 'conflict'" plain type="warning">冲突</van-tag>
            <van-tag v-else-if="row.holiday_skip" plain type="danger">节假日</van-tag>
            <van-tag v-else plain>已排除</van-tag>
          </div>
          <van-empty v-if="!plan.length" image="search" description="这段日期里没有符合星期条件的日子" />
        </div>
        <div v-if="summary.ok || summary.holiday" class="muted" style="margin: 10px 18px 0">
          点任意一行可排除 / 恢复；节假日默认跳过，点一下改为照常排课。
        </div>
      </template>
    </div>

    <div class="smart-foot">
      <van-button v-if="step === 'preview'" round plain @click="step = 'form'">返回修改</van-button>
      <van-button v-if="step === 'form'" round block type="primary" :loading="loading" @click="preview">
        生成预览
      </van-button>
      <van-button v-else round block type="primary" :loading="creating" :disabled="!summary.ok" @click="create">
        创建 {{ summary.ok }} 节课
      </van-button>
    </div>

    <van-popup v-model:show="showClassPicker" round position="bottom">
      <van-picker :columns="classes.map((c) => ({ text: c.name, value: c.id }))" @confirm="pickClass" @cancel="showClassPicker = false" />
    </van-popup>
    <van-popup v-model:show="showTimePicker" round position="bottom">
      <van-picker title="上课时间" :columns="timeColumns" @confirm="pickTime" @cancel="showTimePicker = false" />
    </van-popup>
    <van-popup v-model:show="showDurPicker" round position="bottom">
      <van-picker title="单节时长" :columns="durationOptions" @confirm="pickDuration" @cancel="showDurPicker = false" />
    </van-popup>
    <van-calendar
      v-model:show="showRange"
      type="range"
      :min-date="new Date(2020, 0, 1)"
      :max-date="new Date(2032, 11, 31)"
      :allow-same-day="true"
      @confirm="onRange"
    />
  </van-popup>
</template>
