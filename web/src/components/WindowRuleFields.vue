<script setup>
/**
 * 一条可上课时段的「规则」字段：生效日期范围、单双周、具体某天、时长范围。
 * 直接改传进来的对象（父组件持有草稿数组），不额外维护副本。
 * 老师端与学生端、桌面端与手机端共用同一份，避免三处各写一遍。
 */
import { computed } from 'vue';

const props = defineProps({
  rule: { type: Object, required: true },
  /** 是否展示「具体某天」——代填场景更常用，个人设置里折叠起来 */
  allowSpecificDate: { type: Boolean, default: true },
});

const PARITIES = [
  { value: 'all', text: '每周' },
  { value: 'odd', text: '单周' },
  { value: 'even', text: '双周' },
];

/** 有任意一条高级规则时默认展开，方便看出这天为什么没生效 */
const hasAdvanced = computed(() =>
  !!(props.rule.valid_from || props.rule.valid_to || props.rule.specific_date
    || (props.rule.week_parity && props.rule.week_parity !== 'all')
    || props.rule.min_duration || props.rule.max_duration));

function clearAdvanced() {
  props.rule.valid_from = null;
  props.rule.valid_to = null;
  props.rule.week_parity = 'all';
  props.rule.specific_date = null;
  props.rule.min_duration = 0;
  props.rule.max_duration = 0;
}
</script>

<template>
  <details class="wr" :open="hasAdvanced">
    <summary>
      <span>规则</span>
      <span v-if="hasAdvanced" class="wr-dot" title="已设置高级规则" />
      <span v-else class="wr-none">不限</span>
    </summary>

    <div class="wr-grid">
      <label class="wr-f">
        <span>生效起</span>
        <input v-model="rule.valid_from" type="date" />
      </label>
      <label class="wr-f">
        <span>生效止</span>
        <input v-model="rule.valid_to" type="date" />
      </label>
      <label class="wr-f">
        <span>单双周</span>
        <select v-model="rule.week_parity">
          <option v-for="p in PARITIES" :key="p.value" :value="p.value">{{ p.text }}</option>
        </select>
      </label>
      <label v-if="allowSpecificDate" class="wr-f">
        <span>仅某天</span>
        <input v-model="rule.specific_date" type="date" title="填了就只有这一天生效，忽略上面的星期" />
      </label>
      <label class="wr-f">
        <span>最短时长</span>
        <input v-model.number="rule.min_duration" type="number" min="0" max="480" step="15" placeholder="不限" />
      </label>
      <label class="wr-f">
        <span>最长时长</span>
        <input v-model.number="rule.max_duration" type="number" min="0" max="480" step="15" placeholder="不限" />
      </label>
    </div>

    <div class="wr-foot">
      <span class="wr-hint">留空 = 不限制；时长单位分钟，0 也表示不限</span>
      <button v-if="hasAdvanced" type="button" class="wr-clear" @click="clearAdvanced">清空规则</button>
    </div>
  </details>
</template>

<style scoped>
.wr { margin-top: 6px; border-top: 1px dashed #e6eaf4; padding-top: 6px; }
.wr > summary {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #6b7590;
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.wr > summary::-webkit-details-marker { display: none; }
.wr > summary::before { content: '▸'; font-size: 10px; color: #98a1b5; }
.wr[open] > summary::before { content: '▾'; }
.wr-none { color: #b6bdcc; }
.wr-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--van-primary-color); }
.wr-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(126px, 1fr));
  gap: 8px;
  margin-top: 8px;
}
.wr-f { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: #8a93a8; }
.wr-f input,
.wr-f select {
  padding: 6px 8px;
  border: 1px solid #d9dfec;
  border-radius: 7px;
  font-family: inherit;
  font-size: 12.5px;
  background: #fff;
  color: inherit;
  min-width: 0;
}
.wr-foot { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.wr-hint { font-size: 11.5px; color: #b6bdcc; flex: 1; }
.wr-clear {
  border: none;
  background: none;
  color: var(--van-primary-color);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}

html.dark .wr { border-top-color: #262b3a; }
html.dark .wr-f input,
html.dark .wr-f select { background: #12141c; border-color: #2c3243; }
html.dark .wr > summary { color: #98a1b5; }
</style>
