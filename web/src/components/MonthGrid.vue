<script setup>
/** 月视图日历：桌面端每格显示课程缩略块，手机端显示彩色圆点 + 数量 */
const props = defineProps({
  days: { type: Array, required: true },
  compact: { type: Boolean, default: false },
  maxChips: { type: Number, default: 3 },
});
const emit = defineEmits(['select-day', 'select-lesson']);

const dowLabels = ['一', '二', '三', '四', '五', '六', '日'];
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
        :class="{ out: !cell.inMonth, today: cell.isToday, sel: cell.selected, has: cell.lessons.length }"
        @click="emit('select-day', cell.date)"
      >
        <div class="mg-num">
          <span>{{ cell.day }}</span>
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
          <div class="mg-dots">
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
