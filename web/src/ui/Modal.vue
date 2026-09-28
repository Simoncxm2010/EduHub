<script setup>
import { onBeforeUnmount, onMounted } from 'vue';

/**
 * 桌面端居中弹窗（不用 Vant 的底部弹出，避免电脑上出现手机式交互）。
 * 支持 Esc 关闭、点遮罩关闭、body 滚动锁定。
 */
const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: '' },
  sub: { type: String, default: '' },
  size: { type: String, default: 'normal' }, // normal | wide | narrow
  closeOnMask: { type: Boolean, default: true },
});
const emit = defineEmits(['update:show']);

function close() {
  emit('update:show', false);
}

function onKey(e) {
  if (e.key === 'Escape' && props.show) close();
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
  document.body.style.overflow = props.show ? 'hidden' : '';
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="d-modal-mask" @click.self="closeOnMask && close()">
      <div class="d-modal" :class="size">
        <div class="d-modal-head">
          <div>
            <h3>{{ title }}</h3>
            <div v-if="sub" class="sub">{{ sub }}</div>
          </div>
          <button class="d-modal-close" title="关闭" @click="close">×</button>
        </div>
        <div class="d-modal-body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="d-modal-foot">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
