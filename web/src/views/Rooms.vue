<script setup>
/**
 * 双端访问入口：按视口宽度分流到两套完全独立的界面实现。
 * - 桌面端（>= 960px）：views/desktop/* —— 教室 × 日期的占用表
 * - 手机端（< 960px） ：views/mobile/*  —— 一间教室一张卡片
 * 两端共享同一套 API 与业务逻辑，只分开呈现与交互方式。
 */
import { isDesktop } from '../composables/layout';
import MobileView from './mobile/Rooms.vue';
import DesktopView from './desktop/Rooms.vue';
</script>

<template>
  <DesktopView v-if="isDesktop" />
  <MobileView v-else />
</template>
