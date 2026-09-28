import { ref } from 'vue';

/**
 * 桌面端 / 移动端布局开关（>= 960px 视为桌面）。
 * 模块级单例：只创建一个 matchMedia 监听，各处共享同一个响应式值。
 */
const mql = typeof window !== 'undefined' ? window.matchMedia('(min-width: 960px)') : null;

export const isDesktop = ref(mql ? mql.matches : false);

if (mql) {
  const sync = (e) => { isDesktop.value = e.matches; };
  if (mql.addEventListener) mql.addEventListener('change', sync);
  else mql.addListener(sync);
}

export function useIsDesktop() {
  return isDesktop;
}
