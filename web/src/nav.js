import { computed } from 'vue';

/**
 * 导航项：桌面端侧边栏用完整列表，
 * 手机端底部标签栏只放四项，其余入口收在「我的」里。
 */
export function buildNav(auth) {
  const isAdmin = auth.isAdmin;
  const items = [
    { to: '/', icon: 'wap-home-o', text: '首页', desc: '今日课程与统计', desktop: true, mobile: true },
    { to: '/schedule', icon: 'calendar-o', text: '排课', desc: '周课表与新建课程', desktop: true, mobile: true },
    { to: '/classes', icon: 'friends-o', text: '班级', desc: '班级与学生名单', desktop: true, mobile: true },
    { to: '/requests', icon: 'todo-list-o', text: '申请', desc: '请假与预约课程', desktop: true, mobile: false },
    { to: '/availability', icon: 'clock-o', text: '时段', desc: '可上课时段与智能协调', desktop: true, mobile: false },
    { to: '/admin', icon: 'setting-o', text: '管理后台', desc: '用户、角色与权限', desktop: isAdmin, mobile: false },
    { to: '/me', icon: 'user-o', text: '我的', desc: '账号与日历订阅', desktop: true, mobile: true },
  ];
  return items.filter((i) => i.desktop);
}

export function mobileTabs() {
  return [
    { to: '/', icon: 'wap-home-o', text: '首页' },
    { to: '/schedule', icon: 'calendar-o', text: '排课' },
    { to: '/classes', icon: 'friends-o', text: '班级' },
    { to: '/me', icon: 'user-o', text: '我的' },
  ];
}

/** 手机端「我的」页里的二级入口 */
export function mobileMoreLinks(auth) {
  const links = [
    { to: '/requests', icon: 'todo-list-o', text: '请假与预约', desc: '提交申请、查看审批进度' },
    { to: '/availability', icon: 'clock-o', text: '我的可上课时段', desc: '用于老师协调排课时间' },
  ];
  if (auth.isAdmin) links.push({ to: '/admin', icon: 'setting-o', text: '管理后台', desc: '用户、角色与权限管理' });
  return links;
}

export const ROLE_LABEL = { student: '学生', teacher: '教师', admin: '管理员', super: '超级管理员' };

export function useRoleLabel() {
  return computed(() => ROLE_LABEL);
}
