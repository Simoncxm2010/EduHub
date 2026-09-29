<script setup>
import { computed, ref, watch } from 'vue';
import { showToast } from 'vant';
import api, { toastError } from '../../api';
import Modal from '../../ui/Modal.vue';
import { addDays, cnDate, fmtDate, WEEKDAY_SHORT } from '../../utils';

const props = defineProps({
  show: { type: Boolean, default: false },
  classes: { type: Array, default: () => [] },
  presetClassId: { type: Number, default: null },
});
const emit = defineEmits(['update:show', 'created']);

const todayStr = fmtDate(new Date());
const step = ref('form');
const form = ref({
  class_id: null, weekdays: [], start_time: '18:30', duration_min: 90,
  room: '', topic: '', from: todayStr, to: addDays(todayStr, 55),
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

const DOW = [1, 2, 3, 4, 5, 6, 0];
const durations = [30, 40, 45, 60, 75, 90, 120, 180];
const canPreview = computed(() => !!form.value.class_id && form.value.weekdays.length > 0);

watch(() => props.show, (visible) => {
  if (!visible) return;
  step.value = 'form';
  plan.value = [];
  skipDates.value = [];
  includeDates.value = [];
  skipHolidays.value = true;
  const lastClass = Number(localStorage.getItem('eduhub_last_class')) || null;
  const picked = props.classes.find((c) => c.id === (props.presetClassId || lastClass)) || props.classes[0];
  form.value = {
    class_id: picked?.id ?? null, weekdays: [], start_time: '18:30', duration_min: 90,
    room: '', topic: '', from: todayStr, to: addDays(todayStr, 55),
  };
  suggestion.value = null;
  loadSuggestion();
});

async function loadSuggestion() {
  if (!form.value.class_id) return;
  try {
    const d = await api.get('/lessons/smart/suggest', { params: { class_id: form.value.class_id } });
    suggestion.value = d.suggestion;
    if (!d.suggestion) return;
    form.value.weekdays = [...d.suggestion.weekdays];
    form.value.start_time = d.suggestion.start_time;
    form.value.duration_min = d.suggestion.duration_min;
    form.value.room = d.suggestion.room || '';
  } catch {
    suggestion.value = null;
  }
}

function toggleWeekday(d) {
  const i = form.value.weekdays.indexOf(d);
  if (i >= 0) form.value.weekdays.splice(i, 1);
  else form.value.weekdays.push(d);
}

async function preview() {
  if (!form.value.weekdays.length) return showToast('请选择每周上课的日子');
  if (form.value.to < form.value.from) return showToast('结束日期不能早于开始日期');
  loading.value = true;
  try {
    const d = await api.post('/lessons/smart/plan', {
      ...form.value, skip_dates: skipDates.value, include_dates: includeDates.value,
      skip_holidays: skipHolidays.value, dry_run: true,
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
      ...form.value, skip_dates: skipDates.value, include_dates: includeDates.value,
      skip_holidays: skipHolidays.value, dry_run: false,
    });
    localStorage.setItem('eduhub_last_class', String(form.value.class_id));
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
  <Modal
    :show="show"
    title="智能排课"
    :sub="step === 'form' ? '设定规律，系统自动跳过冲突日期' : `每周 ${form.weekdays.map((d) => '周' + WEEKDAY_SHORT[d]).join('、')} · ${form.start_time} · ${form.duration_min} 分钟`"
    wide
    @update:show="emit('update:show', $event)"
  >
    <template v-if="step === 'form'">
      <div v-if="suggestion" class="smart-tip" style="margin: 0 0 16px">
        <van-icon name="bulb-o" />
        参考该班近 {{ suggestion.sampled }} 节课：通常
        {{ suggestion.weekdays.map((d) => '周' + WEEKDAY_SHORT[d]).join('、') }}
        {{ suggestion.start_time }} 上 {{ suggestion.duration_min }} 分钟{{ suggestion.room ? `，教室 ${suggestion.room}` : '' }}
      </div>

      <div class="d-form two">
        <div class="d-field">
          <label>班级 *</label>
          <select v-model.number="form.class_id" class="d-select" @change="loadSuggestion">
            <option v-for="c in classes" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="d-field">
          <label>上课时间 *</label>
          <input v-model="form.start_time" type="time" class="d-input" />
        </div>
        <div class="d-field">
          <label>单节时长</label>
          <select v-model.number="form.duration_min" class="d-select">
            <option v-for="d in durations" :key="d" :value="d">{{ d }} 分钟</option>
          </select>
        </div>
        <div class="d-field">
          <label>教室</label>
          <input v-model="form.room" class="d-input" placeholder="选填，用于检测教室冲突" />
        </div>
        <div class="d-field">
          <label>起始日期 *</label>
          <input v-model="form.from" type="date" class="d-input" />
        </div>
        <div class="d-field">
          <label>结束日期 *</label>
          <input v-model="form.to" type="date" class="d-input" />
        </div>
        <div class="d-field" style="grid-column: 1 / -1">
          <label>每节课的主题</label>
          <input v-model="form.topic" class="d-input" placeholder="选填，会写入生成的每一节课" />
        </div>
      </div>

      <div class="d-field" style="margin-top: 16px">
        <label>每周上课的日子 *</label>
        <div class="d-inline">
          <button
            v-for="d in DOW"
            :key="d"
            class="d-btn"
            :class="form.weekdays.includes(d) ? 'primary' : ''"
            @click="toggleWeekday(d)"
          >周{{ WEEKDAY_SHORT[d] }}</button>
        </div>
      </div>

      <div class="d-field" style="margin-top: 14px">
        <label class="d-check">
          <input v-model="skipHolidays" type="checkbox" />
          法定节假日不排课（调休补班日照常排）
        </label>
        <div class="muted" style="margin-top: 6px; font-size: 12.5px">
          生成时会自动跳过法定节假日、与该班已有课程冲突、或同一教室被占用的日期。
        </div>
      </div>
    </template>

    <template v-else>
      <div class="smart-summary" style="margin: 0 0 14px">
        <div><b>{{ summary.total }}</b><span>候选日期</span></div>
        <div class="ok"><b>{{ summary.ok }}</b><span>可排</span></div>
        <div class="holiday"><b>{{ summary.holiday || 0 }}</b><span>节假日跳过</span></div>
        <div class="conflict"><b>{{ summary.conflict }}</b><span>冲突跳过</span></div>
        <div class="skip"><b>{{ summary.skip - (summary.holiday || 0) }}</b><span>手动排除</span></div>
      </div>
      <div class="d-scroll" style="max-height: 46vh">
        <table class="d-table">
          <thead>
            <tr><th>日期</th><th>结果</th><th>说明</th><th class="actions">操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in plan" :key="row.date">
              <td class="strong">
                {{ cnDate(row.date) }}
                <span
                  v-if="row.holiday"
                  class="plan-hol"
                  :class="row.holiday.type"
                  :title="row.holiday.type === 'workday' ? `${row.holiday.name}调休补班日` : `${row.holiday.name}法定节假日`"
                >{{ row.holiday.type === 'workday' ? '班' : '休' }}</span>
              </td>
              <td>
                <span
                  class="d-badge"
                  :class="row.status === 'ok' ? 'ok' : row.status === 'conflict' ? 'warn' : row.holiday_skip ? 'danger' : 'mute'"
                >
                  {{ row.status === 'ok' ? '可排' : row.status === 'conflict' ? '冲突' : row.holiday_skip ? '节假日' : '已排除' }}
                </span>
              </td>
              <td style="font-size: 12.5px; color: #98a1b5">{{ row.reason || '—' }}</td>
              <td class="actions">
                <button v-if="row.status !== 'conflict'" class="d-btn sm" @click="toggleSkip(row)">
                  {{ row.status === 'skip' ? (row.holiday_skip ? '照常上课' : '恢复') : '排除' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!plan.length" class="d-empty"><strong>这段日期里没有符合星期条件的日子</strong></div>
      </div>
    </template>

    <template #footer>
      <template v-if="step === 'preview'">
        <button class="d-btn" @click="step = 'form'">返回修改</button>
        <button class="d-btn primary" :disabled="creating || !summary.ok" @click="create">创建 {{ summary.ok }} 节课</button>
      </template>
      <template v-else>
        <button class="d-btn" @click="emit('update:show', false)">取消</button>
        <button class="d-btn primary" :disabled="loading || !canPreview" @click="preview">生成预览</button>
      </template>
    </template>
  </Modal>
</template>
