<script setup>
import { computed, ref, watch } from 'vue';
import { showConfirmDialog, showToast } from 'vant';
import api, { toastError } from '../api';
import { isDesktop } from '../composables/layout';
import { cnDate } from '../utils';

/**
 * 调课：改期 / 换教室 / 与另一节课对调。
 * 边填边做冲突预检（dry_run，不写库），确认时若仍有冲突会让老师二次确认。
 * 桌面端与手机端共用，老师与管理员都能用。
 */
const props = defineProps({
  show: { type: Boolean, default: false },
  /** 要调的课时（含 id / class_name / date / start_time / duration_min / room） */
  lesson: { type: Object, default: null },
});
const emit = defineEmits(['update:show', 'done']);

const mode = ref('move'); // move | swap
const form = ref({ date: '', start_time: '18:00', duration_min: 60, room: '' });
const note = ref('');
const check = ref(null);
const checking = ref(false);
const saving = ref(false);

/** 对调候选 */
const candidates = ref([]);
const loadingCandidates = ref(false);
const picked = ref(null);

let timer = null;
let seq = 0;

watch(() => props.show, (visible) => {
  if (!visible) return;
  mode.value = 'move';
  picked.value = null;
  check.value = null;
  note.value = '';
  const l = props.lesson || {};
  form.value = {
    date: l.date || '',
    start_time: l.start_time || '18:00',
    duration_min: l.duration_min || 60,
    room: l.room || '',
  };
  scheduleCheck();
});

watch(form, scheduleCheck, { deep: true });

/** 防抖 + 丢弃过期响应：连点日期时只有最后一次结果算数 */
function scheduleCheck() {
  if (!props.show || !props.lesson || mode.value !== 'move') return;
  clearTimeout(timer);
  timer = setTimeout(runCheck, 260);
}

async function runCheck() {
  const my = ++seq;
  checking.value = true;
  try {
    const d = await api.post(`/lessons/${props.lesson.id}/reschedule`, {
      ...form.value, dry_run: true,
    });
    if (my === seq) check.value = d;
  } catch (e) {
    if (my === seq) check.value = null;
  } finally {
    if (my === seq) checking.value = false;
  }
}

const conflicts = computed(() => check.value?.conflicts || []);
const unchanged = computed(() => {
  const l = props.lesson;
  if (!l) return true;
  return form.value.date === l.date && form.value.start_time === l.start_time
    && Number(form.value.duration_min) === Number(l.duration_min)
    && String(form.value.room || '') === String(l.room || '');
});

async function submit() {
  if (unchanged.value) return showToast('时间和教室都没有变化');
  if (conflicts.value.length) {
    try {
      await showConfirmDialog({
        title: '目标时间有冲突',
        message: `${conflicts.value.map((c) => c.text).join('\n')}\n\n仍然要调过去吗？`,
      });
    } catch {
      return;
    }
  }
  saving.value = true;
  try {
    await api.post(`/lessons/${props.lesson.id}/reschedule`, { ...form.value, force: true, note: note.value });
    showToast({ type: 'success', message: '已调课' });
    emit('done');
    emit('update:show', false);
  } catch (e) {
    toastError(e);
  } finally {
    saving.value = false;
  }
}

/* ---------------- 对调 ---------------- */

async function loadCandidates() {
  loadingCandidates.value = true;
  try {
    const from = new Date().toLocaleDateString('en-CA');
    const end = new Date();
    end.setDate(end.getDate() + 45);
    const d = await api.get('/lessons', { params: { from, to: end.toLocaleDateString('en-CA') } });
    candidates.value = d.lessons.filter((l) => l.id !== props.lesson?.id && l.status !== 'canceled');
  } catch (e) {
    toastError(e);
  } finally {
    loadingCandidates.value = false;
  }
}

watch(mode, (m) => {
  if (m === 'swap' && !candidates.value.length) loadCandidates();
});

async function doSwap() {
  if (!picked.value) return showToast('先选一节要对调的课');
  saving.value = true;
  try {
    const dry = await api.post(`/lessons/${props.lesson.id}/swap`, { other_id: picked.value.id, dry_run: true });
    if (dry.conflicts?.length) {
      try {
        await showConfirmDialog({
          title: '对调后会有冲突',
          message: `${dry.conflicts.map((c) => c.text).join('\n')}\n\n仍然要对调吗？`,
        });
      } catch {
        return;
      }
    }
    await api.post(`/lessons/${props.lesson.id}/swap`, { other_id: picked.value.id, force: true });
    showToast({ type: 'success', message: '已对调' });
    emit('done');
    emit('update:show', false);
  } catch (e) {
    toastError(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <van-popup
    :show="show"
    round
    :position="isDesktop ? 'center' : 'bottom'"
    class="eduhub-popup eduhub-popup-wide"
    style="padding: 18px 0 20px; max-height: 90vh; display: flex; flex-direction: column"
    @update:show="emit('update:show', $event)"
  >
    <div class="form-title">
      <van-icon name="exchange" /> 调课
      <span class="muted" style="font-weight: 400; margin-left: 8px">{{ lesson?.class_name }}</span>
    </div>

    <div class="rs-modes">
      <button type="button" :class="{ on: mode === 'move' }" @click="mode = 'move'">改期 / 换教室</button>
      <button type="button" :class="{ on: mode === 'swap' }" @click="mode = 'swap'">与另一节课对调</button>
    </div>

    <div style="flex: 1; overflow-y: auto; min-height: 0">
      <template v-if="mode === 'move'">
        <div class="rs-now">
          当前：{{ lesson ? `${cnDate(lesson.date)} ${lesson.start_time} · ${lesson.duration_min} 分钟${lesson.room ? ' · ' + lesson.room : ''}` : '—' }}
        </div>

        <van-cell-group inset>
          <van-field label="日期">
            <template #input><input v-model="form.date" type="date" class="rs-input" /></template>
          </van-field>
          <van-field label="开始时间">
            <template #input><input v-model="form.start_time" type="time" class="rs-input" /></template>
          </van-field>
          <van-field label="时长（分钟）">
            <template #input><input v-model.number="form.duration_min" type="number" min="15" max="480" step="15" class="rs-input" /></template>
          </van-field>
          <van-field v-model="form.room" label="教室" placeholder="选填，用于检测教室冲突" />
          <van-field v-model="note" label="备注" placeholder="选填，会记入调课记录" />
        </van-cell-group>

        <div class="rs-check">
          <van-loading v-if="checking" size="16">检测冲突…</van-loading>
          <template v-else-if="check">
            <div v-if="!conflicts.length" class="rs-ok"><van-icon name="passed" /> 目标时间没有冲突</div>
            <div v-else class="rs-bad">
              <div v-for="(c, i) in conflicts" :key="i"><van-icon name="warning-o" /> {{ c.text }}</div>
            </div>
          </template>
        </div>
      </template>

      <template v-else>
        <div class="rs-now">
          选一节要对调的课：两节课的时间与教室会互换（未来 45 天内）
        </div>
        <van-loading v-if="loadingCandidates" style="margin: 20px auto" vertical>加载中…</van-loading>
        <div v-else-if="!candidates.length" class="rs-empty">这段时间没有可对调的课</div>
        <div v-else class="rs-list">
          <div
            v-for="l in candidates"
            :key="l.id"
            class="rs-item"
            :class="{ on: picked?.id === l.id }"
            @click="picked = l"
          >
            <span class="rs-dot" :style="{ background: l.class_color }" />
            <div style="flex: 1; min-width: 0">
              <div class="rs-item-t">{{ cnDate(l.date) }} {{ l.start_time }} · {{ l.duration_min }} 分钟</div>
              <div class="rs-item-s">{{ l.class_name }}{{ l.room ? ` · ${l.room}` : '' }}</div>
            </div>
            <van-icon v-if="picked?.id === l.id" name="success" color="#07c160" />
          </div>
        </div>
      </template>
    </div>

    <div class="rs-foot">
      <van-button round plain block @click="emit('update:show', false)">取消</van-button>
      <van-button
        v-if="mode === 'move'"
        round
        block
        type="primary"
        :loading="saving"
        :disabled="unchanged"
        @click="submit"
      >{{ conflicts.length ? '仍有冲突，强制调课' : '确认调课' }}</van-button>
      <van-button v-else round block type="primary" :loading="saving" :disabled="!picked" @click="doSwap">确认对调</van-button>
    </div>
  </van-popup>
</template>

<style scoped>
.rs-modes { display: flex; gap: 6px; margin: 10px 16px 4px; }
.rs-modes button {
  flex: 1;
  padding: 8px 0;
  border: 1px solid #e2e7f3;
  background: #fff;
  border-radius: 9px;
  font-family: inherit;
  font-size: 13px;
  color: #4a5470;
  cursor: pointer;
}
.rs-modes button.on { border-color: var(--van-primary-color); color: var(--van-primary-color); background: #eef3ff; }
.rs-now { font-size: 12.5px; color: #8a93a8; margin: 10px 20px 12px; line-height: 1.6; }
.rs-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: 14px;
  color: inherit;
  text-align: right;
}
.rs-check { margin: 12px 20px 0; }
.rs-ok { font-size: 12.5px; color: #07c160; }
.rs-bad { font-size: 12.5px; color: #d03050; line-height: 1.7; }
.rs-empty { text-align: center; color: #98a1b5; font-size: 13px; padding: 24px 0; }
.rs-list { max-height: 46vh; overflow-y: auto; margin: 0 12px; }
.rs-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 8px;
  border-radius: 10px;
  cursor: pointer;
}
.rs-item.on { background: #eef3ff; }
.rs-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.rs-item-t { font-size: 13.5px; font-weight: 600; }
.rs-item-s { font-size: 12px; color: #8a93a8; margin-top: 2px; }
.rs-foot { display: flex; gap: 10px; padding: 14px 16px 0; }

html.dark .rs-modes button { background: #171a24; border-color: #2c3243; color: #b6bdcc; }
html.dark .rs-modes button.on { background: #1b2030; }
html.dark .rs-item.on { background: #1b2030; }
</style>
