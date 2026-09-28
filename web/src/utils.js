export const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** Date -> YYYY-MM-DD（本地时区） */
export function fmtDate(d) {
  return d.toLocaleDateString('en-CA');
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

/** 返回某天所在周的周一 */
export function weekStartOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return addDays(dateStr, -((d.getDay() + 6) % 7));
}

/** 开始时间 + 时长(分钟) -> 结束时间 HH:MM */
export function endTime(start, dur) {
  const [h, m] = start.split(':').map(Number);
  const t = h * 60 + m + Number(dur || 0);
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** "9月27日 周六" */
export function cnDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY_CN[d.getDay()]}`;
}

/** 'HH:MM' -> 分钟数 */
export function toMin(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

/** 分钟数 -> 'HH:MM' */
export function minToTime(m) {
  const v = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** 当前时刻的分钟数 */
export function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** 某月第一天 / 该月日历网格的第一天（周一开头） */
export function monthStartOf(dateStr) {
  return `${dateStr.slice(0, 7)}-01`;
}

export const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

export const LESSON_STATUS = {
  scheduled: { text: '待上课', color: 'primary' },
  done: { text: '已完成', color: 'success' },
  canceled: { text: '已取消', color: 'default' },
};

export const ATTEND_STATUS = {
  present: { text: '出勤', color: '#07c160' },
  late: { text: '迟到', color: '#ff976a' },
  absent: { text: '缺勤', color: '#ee0a24' },
  leave: { text: '请假', color: '#1989fa' },
};

export function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 9) return '早上好';
  if (h < 12) return '上午好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}
