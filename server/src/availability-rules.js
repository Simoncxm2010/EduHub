/**
 * 可上课时段规则：校验、以及「这条规则在某个日期是否生效」的判断。
 *
 * 一条规则比「每周几 18:00-21:00」更细，可以是：
 *   - 只在某段日期内生效（valid_from / valid_to）
 *   - 只在单周或双周生效（week_parity，按 ISO 周序号）
 *   - 只作用于某一个具体日期（specific_date，此时 weekday 由日期推导）
 *   - 只接受某个时长范围（min_duration / max_duration）
 *
 * 抽成独立模块是为了能单独测：日期边界、跨年单双周这些地方最容易算错。
 */
import { isDate, isTime, toMin, weekdayOf, isoWeek } from './util.js';

export const PARITIES = ['all', 'odd', 'even'];
export const PARITY_CN = { all: '每周', odd: '单周', even: '双周' };

const MAX_DURATION_LIMIT = 480;
const MIN_DURATION_LIMIT = 15;
const MAX_NOTE = 60;

/** 时长字段：0 或空 = 不限 */
function normalizeDuration(value, label) {
  if (value === undefined || value === null || value === '') return { value: 0 };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return { error: `${label}必须是非负整数分钟` };
  if (n === 0) return { value: 0 };
  if (n < MIN_DURATION_LIMIT || n > MAX_DURATION_LIMIT) {
    return { error: `${label}需在 ${MIN_DURATION_LIMIT}–${MAX_DURATION_LIMIT} 分钟之间` };
  }
  return { value: n };
}

function normalizeDate(value, label) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (!isDate(value)) return { error: `${label}格式不正确` };
  return { value };
}

/**
 * 校验并规范化一条规则。
 * @returns {{ rule: object } | { error: string }}
 */
export function normalizeRule(raw) {
  const it = raw || {};

  const specific = normalizeDate(it.specific_date, '具体日期');
  if (specific.error) return specific;

  // 指定了具体日期时，星期由该日期推导，忽略前端传来的 weekday（避免两者打架）
  let weekday;
  if (specific.value) {
    weekday = weekdayOf(specific.value);
  } else {
    weekday = Number(it.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { error: '星期不正确' };
  }

  if (!isTime(it.start_time) || !isTime(it.end_time)) return { error: '时间格式不正确' };
  if (toMin(it.start_time) >= toMin(it.end_time)) return { error: '开始时间必须早于结束时间' };

  const parity = it.week_parity === undefined || it.week_parity === null || it.week_parity === ''
    ? 'all'
    : String(it.week_parity);
  if (!PARITIES.includes(parity)) return { error: '单双周取值不正确' };

  const from = normalizeDate(it.valid_from, '生效起始日期');
  if (from.error) return from;
  const to = normalizeDate(it.valid_to, '生效结束日期');
  if (to.error) return to;
  if (from.value && to.value && from.value > to.value) return { error: '生效起始日期不能晚于结束日期' };

  const minD = normalizeDuration(it.min_duration, '最短时长');
  if (minD.error) return minD;
  const maxD = normalizeDuration(it.max_duration, '最长时长');
  if (maxD.error) return maxD;
  if (minD.value && maxD.value && minD.value > maxD.value) return { error: '最短时长不能大于最长时长' };

  return {
    rule: {
      weekday,
      start_time: it.start_time,
      end_time: it.end_time,
      note: String(it.note || '').slice(0, MAX_NOTE),
      valid_from: from.value,
      valid_to: to.value,
      week_parity: parity,
      specific_date: specific.value,
      min_duration: minD.value,
      max_duration: maxD.value,
    },
  };
}

/** 这条规则是否作用于某一天 */
export function appliesOn(rule, date) {
  if (rule.specific_date) return rule.specific_date === date;
  if (rule.valid_from && date < rule.valid_from) return false;
  if (rule.valid_to && date > rule.valid_to) return false;
  if (rule.week_parity && rule.week_parity !== 'all') {
    const parity = isoWeek(date) % 2 === 1 ? 'odd' : 'even';
    if (parity !== rule.week_parity) return false;
  }
  return Number(rule.weekday) === weekdayOf(date);
}

/** 这个时段能否容纳一节给定长度的课 */
export function allowsDuration(rule, duration) {
  const d = Number(duration) || 0;
  const min = Number(rule.min_duration) || 0;
  const max = Number(rule.max_duration) || 0;
  if (min && d < min) return false;
  if (max && d > max) return false;
  return true;
}

/** 规则的中文摘要，用于列表与提示 */
export function ruleSummary(rule) {
  const parts = [];
  if (rule.specific_date) parts.push(rule.specific_date);
  else if (rule.week_parity && rule.week_parity !== 'all') parts.push(PARITY_CN[rule.week_parity]);
  if (rule.valid_from || rule.valid_to) {
    parts.push(`${rule.valid_from || '不限'} ~ ${rule.valid_to || '不限'}`);
  }
  if (rule.min_duration || rule.max_duration) {
    parts.push(`${rule.min_duration || '不限'}-${rule.max_duration || '不限'} 分钟`);
  }
  return parts.join(' · ');
}

/** 一组规则里，某一天生效的那些 */
export function rulesOn(rules, date) {
  return rules.filter((r) => appliesOn(r, date));
}
