
/**
 * 导航项：桌面端侧边栏用完整列表，
 * 手机端底部标签栏只放四项，其余入口收在「我的」里。
 */
export function buildNav(auth) {
  const items = [
    { to: '/', icon: 'wap-home-o', text: '首页', desc: '今日课程与统计' },
    { to: '/schedule', icon: 'calendar-o', text: '排课', desc: '周课表与新建课程' },
    { to: '/classes', icon: 'friends-o', text: '班级', desc: '班级与学生名单' },
    { to: '/requests', icon: 'todo-list-o', text: '申请', desc: '请假与预约课程' },
    { to: '/availability', icon: 'clock-o', text: '时段', desc: '可上课时段与智能协调' },
    { to: '/notifications', icon: 'bell', text: '通知', desc: '审批结果与新申请' },
    { to: '/admin', icon: 'setting-o', text: '管理后台', desc: '用户、角色与权限', adminOnly: true },
    { to: '/me', icon: 'user-o', text: '我的', desc: '账号与日历订阅' },
  ];
  return items.filter((i) => !i.adminOnly || auth.isAdmin);
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
    { to: '/notifications', icon: 'bell', text: '我的通知', desc: '审批结果与新申请提醒' },
  ];
  if (auth.isAdmin) links.push({ to: '/admin', icon: 'setting-o', text: '管理后台', desc: '用户、角色与权限管理' });
  return links;
}
