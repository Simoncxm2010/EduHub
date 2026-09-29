import { useRouter } from 'vue-router';

/**
 * 统一的「返回」动作。
 *
 * 直接用链接打开或刷新页面时浏览器没有上一条历史，router.back() 点了毫无反应；
 * 这种情况下退回到指定的兜底路由，保证按钮永远有效。
 */
export function useBack(fallback = '/') {
  const router = useRouter();
  return () => {
    // Vue Router 会把来源记在 history.state.back，为空即表示没有可返回的上一页
    if (window.history.state?.back) router.back();
    else router.replace(fallback);
  };
}
