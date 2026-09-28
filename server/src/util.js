import crypto from 'node:crypto';

/** 生成 6 位不混淆字符的邀请码 */
export function genInviteCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** 日期字符串 YYYY-MM-DD 加 n 天 */
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

/** 校验日期格式 YYYY-MM-DD */
export function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00`).getTime());
}

/** 校验时间格式 HH:MM */
export function isTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** 本地时区的当前时刻，格式 YYYY-MM-DD HH:MM:SS */
export function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 'HH:MM' -> 分钟数 */
export function toMin(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

/** 分钟数 -> 'HH:MM'（自动按天取模） */
export function minToTime(m) {
  const v = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** 星期几：0=周日 */
export function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00`).getDay();
}

/** 闭区间内的每一天（带安全上限，避免误传超大区间） */
export function eachDate(from, to) {
  const out = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** 包装异步路由，统一错误返回 */
export function h(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const CLASS_COLORS = ['#4F6EF2', '#00B8A9', '#F6416C', '#FF9F1C', '#8E6FF7', '#2D9CDB'];
export function pickColor() {
  return CLASS_COLORS[crypto.randomInt(CLASS_COLORS.length)];
}
