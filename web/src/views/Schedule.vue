<script setup>
/**
 * 双端访问入口：按视口宽度分流到两套完全独立的界面实现。
 * - 桌面端（>= 960px）：views/desktop/* —— 原生表格 / 表单 / 自绘居中弹窗，不使用手机式组件
 * - 手机端（< 960px） ：views/mobile/*  —— 基于 Vant 的移动交互（底部标签栏、底部弹出）
 * 两端共享同一套 API 与业务逻辑，只分开呈现与交互方式。
 */
import { isDesktop } from '../composables/layout';
import MobileView from './mobile/Schedule.vue';
import DesktopView from './desktop/Schedule.vue';
</script>

<template>
  <DesktopView v-if="isDesktop" />
  <MobileView v-else />
</template>
