<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';

/** 手写签名画板：Pointer 事件绘制，导出时会自动裁掉四周空白 */
const props = defineProps({
  height: { type: Number, default: 200 },
  penWidth: { type: Number, default: 2.6 },
  penColor: { type: String, default: '#1b2233' },
});
const emit = defineEmits(['change']);

const wrap = ref(null);
const canvas = ref(null);
const hasInk = ref(false);

let ctx = null;
let drawing = false;
let last = null;
let dpr = 1;
let lastWidth = 0;
let observer = null;

function setup() {
  const el = canvas.value;
  const box = wrap.value;
  if (!el || !box) return;
  const width = box.clientWidth;
  if (!width) return;
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  // 赋值 width 会重置画布状态（含变换），所以每次重新设置后再 scale
  el.width = Math.round(width * dpr);
  el.height = Math.round(props.height * dpr);
  el.style.width = '100%';
  el.style.height = `${props.height}px`;
  ctx = el.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineWidth = props.penWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = props.penColor;
  hasInk.value = false;
  emit('change', false);
}

function toLocal(e) {
  const rect = canvas.value.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  if (!ctx) setup();
  drawing = true;
  last = toLocal(e);
  // 单点也要留痕
  ctx.beginPath();
  ctx.arc(last.x, last.y, props.penWidth / 2.4, 0, Math.PI * 2);
  ctx.fillStyle = props.penColor;
  ctx.fill();
  if (!hasInk.value) {
    hasInk.value = true;
    emit('change', true);
  }
  // 指针已失效时 setPointerCapture 会抛错，不能因此中断整笔书写
  try {
    canvas.value.setPointerCapture?.(e.pointerId);
  } catch {
    /* 忽略：仍然可以靠 pointermove 继续书写 */
  }
}

function onMove(e) {
  if (!drawing || !ctx) return;
  e.preventDefault();
  // 合并同一帧内的多个点，避免抖动
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events) {
    const p = toLocal(ev);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  }
}

function onUp() {
  drawing = false;
  last = null;
}

function clear() {
  const el = canvas.value;
  if (!el || !ctx) return;
  ctx.clearRect(0, 0, el.width, el.height);
  hasInk.value = false;
  emit('change', false);
}

/** 导出紧凑 PNG（白底，已裁掉空白边） */
function exportPNG() {
  const el = canvas.value;
  if (!el || !ctx || !hasInk.value) return null;
  const W = el.width;
  const H = el.height;
  const data = ctx.getImageData(0, 0, W, H).data;
  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = Math.round(10 * dpr);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(W - 1, maxX + pad);
  maxY = Math.min(H - 1, maxY + pad);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, w, h);
  octx.drawImage(el, minX, minY, w, h, 0, 0, w, h);
  return out.toDataURL('image/png');
}

onMounted(() => {
  setup();
  // 弹窗动画、旋转屏幕、窗口缩放都会改变可用宽度：没有笔迹时按新宽度重建
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      const w = wrap.value?.clientWidth || 0;
      if (!w || Math.abs(w - lastWidth) < 2 || hasInk.value) return;
      lastWidth = w;
      setup();
    });
    observer.observe(wrap.value);
  }
});

onBeforeUnmount(() => observer?.disconnect());

defineExpose({ clear, exportPNG, hasInk });
</script>

<template>
  <div class="sig">
    <div ref="wrap" class="sig-wrap">
      <canvas
        ref="canvas"
        class="sig-canvas"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointerleave="onUp"
        @pointercancel="onUp"
      />
      <div v-if="!hasInk" class="sig-hint">请在此处手写签名</div>
    </div>
    <div class="sig-bar">
      <span class="muted">用手指或鼠标书写</span>
      <van-button size="small" plain round icon="delete-o" @click="clear">重写</van-button>
    </div>
  </div>
</template>
