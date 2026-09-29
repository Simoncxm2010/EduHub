<script setup>
import { computed } from 'vue';
import { cnDate } from '../utils';

/**
 * 调课 / 停课留痕列表。
 * 老师端最关心的是「从什么时间挪到了什么时间」，所以这里把 before/after
 * 拼成一句人话，而不是直接摊原始 JSON。
 */
const props = defineProps({
  changes: { type: Array, default: () => [] },
  /** 紧凑模式用于课时详情侧栏 */
  dense: { type: Boolean, default: false },
});

const ACTION = {
  reschedule: { text: '调课', type: 'primary' },
  swap: { text: '对调', type: 'warning' },
  cancel: { text: '取消', type: 'danger' },
  resume: { text: '恢复', type: 'success' },
  done: { text: '完成', type: 'success' },
  edit: { text: '修改', type: 'default' },
};

function slot(s) {
  if (!s || !s.date) return '—';
  return `${cnDate(s.date)} ${s.start_time || ''}`.trim();
}

/** 把一条留痕说成一句人话 */
function describe(ch) {
  const b = ch.before || {};
  const a = ch.after || {};
  const parts = [];

  if (ch.action === 'swap') {
    parts.push(`与《${a.with_class || '另一节课'}》对调`);
    parts.push(`${slot(b)} → ${slot(a)}`);
  } else if (ch.action === 'reschedule') {
    // 只改了时长或教室时不要写成「19:30 → 19:30」，那样反而看不懂
    if (b.date !== a.date || b.start_time !== a.start_time) parts.push(`${slot(b)} → ${slot(a)}`);
  } else if (ch.action === 'cancel') {
    parts.push('取消课时');
  } else if (ch.action === 'resume') {
    parts.push('恢复排课');
  } else if (ch.action === 'done') {
    parts.push('标记为已完成');
  } else {
    if (b.date && (b.date !== a.date || b.start_time !== a.start_time)) {
      parts.push(`${slot(b)} → ${slot(a)}`);
    }
  }

  // 时长 / 教室变化单独点出来
  const extras = [];
  if (b.duration_min && a.duration_min && b.duration_min !== a.duration_min) {
    extras.push(`${b.duration_min} → ${a.duration_min} 分钟`);
  }
  if ((b.room || '') !== (a.room || '') && (b.room || a.room)) {
    extras.push(`教室 ${b.room || '未填'} → ${a.room || '未填'}`);
  }
  if (extras.length) parts.push(extras.join('，'));

  return parts.join('；') || '—';
}

const rows = computed(() => props.changes.map((ch) => ({
  ...ch,
  meta: ACTION[ch.action] || { text: ch.action, type: 'default' },
  desc: describe(ch),
})));
</script>

<template>
  <div class="cl" :class="{ dense }">
    <div v-if="!rows.length" class="cl-empty">
      暂无调课或停课记录
    </div>
    <div v-for="r in rows" :key="r.id" class="cl-row">
      <span class="cl-tag" :class="r.meta.type">{{ r.meta.text }}</span>
      <div class="cl-body">
        <div class="cl-desc">{{ r.desc }}</div>
        <div class="cl-meta">
          {{ r.actor_name || '—' }}
          <template v-if="r.class_name && dense"> · {{ r.class_name }}</template>
          · {{ (r.created_at || '').slice(0, 16) }}
          <template v-if="r.note"> · {{ r.note }}</template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cl { display: flex; flex-direction: column; }
.cl-empty { font-size: 13px; color: #98a1b5; padding: 14px 0; text-align: center; }
.cl-row { display: flex; gap: 9px; padding: 10px 0; border-bottom: 1px solid #f1f3f9; }
.cl-row:last-child { border-bottom: none; }
.dense .cl-row { padding: 8px 0; }
.cl-tag {
  flex: none;
  align-self: flex-start;
  font-size: 11px;
  line-height: 1.6;
  padding: 1px 7px;
  border-radius: 6px;
  background: #eef2ff;
  color: #4f6ef2;
}
.cl-tag.warning { background: #fff7e8; color: #b26a00; }
.cl-tag.danger { background: #ffecec; color: #d03050; }
.cl-tag.success { background: #e8f8ee; color: #07a352; }
.cl-tag.default { background: #f1f3f9; color: #6b7590; }
.cl-body { min-width: 0; flex: 1; }
.cl-desc { font-size: 13.5px; color: #2a3350; word-break: break-word; }
.cl-meta { font-size: 11.5px; color: #98a1b5; margin-top: 3px; }

html.dark .cl-row { border-bottom-color: #262b3a; }
html.dark .cl-desc { color: #e4e7f0; }
html.dark .cl-tag { background: #1b2030; color: #8fa3f0; }
html.dark .cl-tag.warning { background: #3a2a12; color: #ffb35c; }
html.dark .cl-tag.danger { background: #3a1a20; color: #ff8093; }
html.dark .cl-tag.success { background: #14301f; color: #4ade80; }
html.dark .cl-tag.default { background: #1d2130; color: #98a1b5; }
</style>
