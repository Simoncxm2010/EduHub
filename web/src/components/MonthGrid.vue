<script setup>
/** 月视图日历：桌面端每格显示课程缩略块，手机端显示彩色圆点 + 数量 */
const props = defineProps({
  days: { type: Array, required: true },
  compact: { type: Boolean, default: false },
  maxChips: { type: Number, default: 3 },
  /** date -> { name, type: 'holiday' | 'workday' }（国家法定节假日） */
  holidayMap: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['select-day', 'select-lesson']);

const dowLabels = ['一', '二', '三', '四', '五', '六', '日'];

function holidayOf(date) {
  return props.holidayMap?.[date] ?? null;
}

/** 节假日徽标文字：放假「休」、调休补班「班」 */
function holChar(date) {
  const h = holidayOf(date);
  return h ? (h.type === 'workday' ? '班' : '休') : '';
}

function cellTitle(cell) {
  const h = holidayOf(cell.date);
  if (!h) return undefined;
  return h.type === 'workday' ? `${h.name}（调休补班日）` : `${h.name}（法定节假日）`;
}
</script>

<template>
  <div class="mg" :class="{ 'mg-compact': compact }">
    <div class="mg-head">
      <div v-for="d in dowLabels" :key="d" class="mg-dow">{{ d }}</div>
    </div>
    <div class="mg-grid">
      <div
        v-for="cell in days"
        :key="cell.date"
        class="mg-cell"
        :class="{
          out: !cell.inMonth,
          today: cell.isToday,
          sel: cell.selected,
          has: cell.lessons.length,
          holiday: holidayOf(cell.date)?.type === 'holiday',
          workday: holidayOf(cell.date)?.type === 'workday',
        }"
        :title="cellTitle(cell)"
        @click="emit('select-day', cell.date)"
      >
        <div class="mg-num">
          <span class="mg-day">{{ cell.day }}</span>
          <!-- 桌面端格子宽裕，徽标跟在日期后面 -->
          <span
            v-if="!compact && holidayOf(cell.date)"
            class="mg-hol"
            :class="holidayOf(cell.date).type"
          >{{ holChar(cell.date) }}</span>
          <span v-if="compact && cell.lessons.length" class="mg-count">{{ cell.lessons.length }}</span>
        </div>

        <template v-if="!compact">
          <div
            v-for="l in cell.lessons.slice(0, maxChips)"
            :key="l.id"
            class="mg-chip"
            :class="{ canceled: l.status === 'canceled' }"
            :style="{ '--bar': l.class_color }"
            :title="`${l.class_name} ${l.start_time}`"
            @click.stop="emit('select-lesson', l)"
          >
            <span class="mg-chip-time">{{ l.start_time }}</span>
            <span class="mg-chip-name">{{ l.class_name }}</span>
          </div>
          <div v-if="cell.lessons.length > maxChips" class="mg-more">
            +{{ cell.lessons.length - maxChips }} 节
          </div>
        </template>

        <template v-else>
          <!-- 手机端每格只有约 38px，徽标放到第二行与课程圆点并排，否则首行会横向溢出 -->
          <div class="mg-dots">
            <span
              v-if="holidayOf(cell.date)"
              class="mg-hol"
              :class="holidayOf(cell.date).type"
            >{{ holChar(cell.date) }}</span>
            <span
              v-for="l in cell.lessons.slice(0, 3)"
              :key="l.id"
              class="mg-dot"
              :style="{ background: l.class_color }"
            />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
