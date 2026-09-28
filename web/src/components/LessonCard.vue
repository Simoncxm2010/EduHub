<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { endTime, LESSON_STATUS } from '../utils';

const props = defineProps({
  lesson: { type: Object, required: true },
  showDate: { type: Boolean, default: false },
});

const router = useRouter();
const status = computed(() => LESSON_STATUS[props.lesson.status] || LESSON_STATUS.scheduled);
const signedCount = computed(() => Number(props.lesson.signed_count || 0));

function open() {
  router.push(`/lessons/${props.lesson.id}`);
}
</script>

<template>
  <div class="lesson-card" :class="{ 'is-canceled': lesson.status === 'canceled' }" @click="open">
    <div class="lesson-top">
      <span class="lesson-dot" :style="{ background: lesson.class_color }" />
      <span class="lesson-class">{{ lesson.class_name }}</span>
      <van-tag :type="status.color">{{ status.text }}</van-tag>
    </div>
    <div class="lesson-time">
      <van-icon name="clock-o" />
      <template v-if="showDate">{{ lesson.date }} · </template>
      {{ lesson.start_time }} - {{ endTime(lesson.start_time, lesson.duration_min) }}
      <span class="muted">（{{ lesson.duration_min }} 分钟）</span>
    </div>
    <div class="lesson-meta">
      <span v-if="lesson.room"><van-icon name="location-o" /> {{ lesson.room }}</span>
      <span v-if="lesson.checked_count != null && lesson.student_count != null">
        <van-icon name="user-o" /> 签到 {{ lesson.checked_count }}/{{ lesson.student_count }}
      </span>
      <span v-if="signedCount" class="trace-badges">
        <van-icon name="edit" /> 签名 {{ signedCount }}
      </span>
      <span v-if="lesson.has_checkin" class="trace-badges">
        <van-icon name="photograph" /> 已留痕
      </span>
    </div>
    <div v-if="lesson.topic" class="lesson-topic">{{ lesson.topic }}</div>
  </div>
</template>
