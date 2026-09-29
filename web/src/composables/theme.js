import { computed, ref, watchEffect } from 'vue';
import api from '../api';

/**
 * 界面主题：亮色 / 暗色 / 跟随系统。
 * - 模式存 localStorage（启动即用，防闪白），登录后以服务端为准同步（跨设备一致）
 * - resolvedTheme 是最终生效的亮/暗；「跟随系统」实时响应系统切换
 * - html 上同时挂 dark 与 van-theme-dark：自定义样式与 Vant 组件（含传送门弹层）一起变暗
 */
const KEY = 'eduhub_theme';
const VALID = ['light', 'dark', 'system'];

const mode = ref(readStored());
const systemDark = ref(typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)').matches
  : false);

function readStored() {
  try {
    const v = localStorage.getItem(KEY);
    return VALID.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = (e) => { systemDark.value = e.matches; };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else mq.addListener(onChange);
}

export const themeMode = computed(() => mode.value);
export const resolvedTheme = computed(() =>
  mode.value === 'system' ? (systemDark.value ? 'dark' : 'light') : mode.value
);

let inited = false;

/** 应用当前解析出的主题到 <html>（main.js 挂载前调用，避免闪白） */
export function initTheme() {
  if (inited) return;
  inited = true;
  watchEffect(() => {
    const dark = resolvedTheme.value === 'dark';
    const el = document.documentElement;
    el.classList.toggle('dark', dark);
    el.classList.toggle('van-theme-dark', dark);
    // PWA 状态栏 / 浏览器 UI 颜色跟随
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#12141c' : '#4f6ef2');
  });
}

/** 用户手动切换：写本地 + 登录态下同步到服务端 */
export function setThemeMode(next) {
  if (!VALID.includes(next)) return;
  mode.value = next;
  try { localStorage.setItem(KEY, next); } catch { /* 忽略 */ }
  api.put('/auth/theme', { theme: next }).catch(() => {});
}

/** 登录 / 注册 / 拉取个人信息后调用：服务端值优先（跨设备一致） */
export function syncThemeFromUser(user) {
  if (!user?.theme || !VALID.includes(user.theme)) return;
  if (user.theme === mode.value) return;
  mode.value = user.theme;
  try { localStorage.setItem(KEY, user.theme); } catch { /* 忽略 */ }
}
