/**
 * 法定节假日数据的自动同步。
 *
 * 内置表（holidays.js 的 HOLIDAYS）只覆盖到已公布通知的年份，跨年就会「没数据」。
 * 这里从外部数据源按年抓取，落库到 holiday_sync，同年的内置数据会被整体覆盖。
 *
 * 设计取向：
 * - 尽力而为：同步失败只是回退到内置表，绝不影响排课等主流程；
 * - 存库缓存：离线部署重启后仍能用最后一次同步到的数据；
 * - 默认开启，可用 EDUHUB_HOLIDAY_SYNC=0 关闭（内网部署常见诉求）。
 *
 * 数据源返回形如：
 *   { code: 0, holiday: { '01-01': { holiday: true, name: '元旦', date: '2026-01-01' },
 *                         '01-04': { holiday: false, name: '元旦后补班', target: '元旦', date: '2026-01-04' } } }
 * 其中 holiday=true 为放假日，false 为调休补班日。
 */
import { saveSyncedYear, syncedInfo } from './holidays.js';

const DEFAULT_SOURCE = 'timor.tech';
const DEFAULT_BASE_URL = 'https://timor.tech/api/holiday/year/';
const FETCH_TIMEOUT_MS = 15000;
/** 同一年的数据多久重新抓一次；未公布的年份因为没有落库记录，会按天重试直到拿到 */
const MAX_AGE_DAYS = 30;

/** 春节假期在数据源里逐日细分为「除夕 / 初一…初七」，统一归到春节名下 */
const FESTIVAL_ALIAS = { 除夕: '春节' };

function canonicalName(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  if (FESTIVAL_ALIAS[raw]) return FESTIVAL_ALIAS[raw];
  if (/^初[一二三四五六七八九十]$/.test(raw)) return '春节';
  return raw;
}

/** 补班日的名字形如「春节前补班」「国庆节后补班」，取节日名 */
function workdayName(item) {
  if (item?.target) return canonicalName(item.target);
  return canonicalName(String(item?.name || '').replace(/(前|后)?补班$/, '').replace(/调休$/, ''));
}

export function syncEnabled() {
  return process.env.EDUHUB_HOLIDAY_SYNC !== '0';
}

function sourceBaseUrl() {
  return process.env.EDUHUB_HOLIDAY_SOURCE_URL || DEFAULT_BASE_URL;
}

function sourceName() {
  try {
    return new URL(sourceBaseUrl()).host || DEFAULT_SOURCE;
  } catch {
    return DEFAULT_SOURCE;
  }
}

/**
 * 把数据源的原始 JSON 归一成 [{ name, dates, workdays }]（与内置表同构）。
 * 纯函数，便于测试。
 */
export function normalizeYear(year, payload) {
  const raw = payload?.holiday;
  if (!raw || typeof raw !== 'object') return [];

  const y = String(year);
  const groups = new Map();
  const group = (name) => {
    if (!groups.has(name)) groups.set(name, { name, dates: [], workdays: [] });
    return groups.get(name);
  };

  for (const item of Object.values(raw)) {
    const date = typeof item?.date === 'string' ? item.date : '';
    // 只收本年度、格式正确的日期，脏数据一律丢弃
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(0, 4) !== y) continue;
    if (item.holiday) {
      const name = canonicalName(item.name) || canonicalName(item.target);
      if (name) group(name).dates.push(date);
    } else {
      const name = workdayName(item);
      if (name) group(name).workdays.push(date);
    }
  }

  const out = [...groups.values()].filter((g) => g.dates.length || g.workdays.length);
  for (const g of out) {
    g.dates = [...new Set(g.dates)].sort();
    g.workdays = [...new Set(g.workdays)].sort();
  }
  return out.sort((a, b) => (a.dates[0] || a.workdays[0] || '').localeCompare(b.dates[0] || b.workdays[0] || ''));
}

/** 抓取并归一某一年；无数据（尚未公布）返回空数组，网络/格式异常抛错 */
export async function fetchYear(year, { fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(`${sourceBaseUrl()}${year}`, {
    headers: { accept: 'application/json', 'user-agent': 'EduHub/0.1 (+holiday-sync)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json?.code !== undefined && json.code !== 0) throw new Error(json.msg || `数据源返回 code=${json.code}`);
  const holidays = normalizeYear(year, json);
  // 没公布安排时接口返回空对象，属于正常情况而非错误
  return { holidays, published: holidays.length > 0 };
}

/** 需要关注的年份：去年（1 月回看要用）、今年、明年 */
export function targetYears(now = new Date()) {
  const y = now.getFullYear();
  return [y - 1, y, y + 1];
}

let lastResult = null;
let running = false;
let timer = null;

/**
 * 同步若干年份，逐年返回结果（单年失败不影响其他年份）。
 * force=false 时，已同步且未过期的年份会被跳过。
 */
export async function syncHolidayYears(years = targetYears(), { force = false, fetchImpl } = {}) {
  const known = new Map(syncedInfo().years.map((y) => [y.year, y]));
  const maxAgeMs = MAX_AGE_DAYS * 24 * 3600 * 1000;
  const results = [];

  for (const year of years) {
    const key = String(year);
    const prev = known.get(key);
    if (!force && prev?.fetched_at) {
      const age = Date.now() - new Date(prev.fetched_at.replace(' ', 'T')).getTime();
      if (Number.isFinite(age) && age < maxAgeMs) {
        results.push({ year: key, status: 'fresh', fetched_at: prev.fetched_at });
        continue;
      }
    }

    try {
      const { holidays, published } = await fetchYear(key, { fetchImpl });
      if (!published) {
        results.push({ year: key, status: 'unpublished' });
        continue;
      }
      saveSyncedYear(key, holidays, sourceName());
      results.push({
        year: key,
        status: 'updated',
        holiday_days: holidays.reduce((n, h) => n + h.dates.length, 0),
        workdays: holidays.reduce((n, h) => n + h.workdays.length, 0),
      });
    } catch (e) {
      // 同步失败不影响任何主流程，只记录原因供管理端查看
      results.push({ year: key, status: 'failed', error: e?.message || String(e) });
    }
  }

  lastResult = { at: new Date().toLocaleString('sv-SE').slice(0, 19), results };
  return results;
}

export function lastSyncResult() {
  return lastResult;
}

/**
 * 启动后台同步：立即跑一次，之后每 intervalHours 小时一次。
 * 定时器 unref，不阻止进程退出（测试与脚本场景友好）。
 */
export function startHolidaySync({ intervalHours = Number(process.env.EDUHUB_HOLIDAY_SYNC_HOURS) || 24 } = {}) {
  if (!syncEnabled() || timer) return timer;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const results = await syncHolidayYears();
      const changed = results.filter((r) => r.status === 'updated');
      if (changed.length) {
        console.log(`[节假日] 已同步 ${changed.map((r) => `${r.year}(${r.holiday_days}天假/${r.workdays}天补班)`).join('、')}`);
      }
      const failed = results.filter((r) => r.status === 'failed');
      if (failed.length) {
        console.warn(`[节假日] 同步失败（继续使用内置数据）：${failed.map((r) => `${r.year} ${r.error}`).join('；')}`);
      }
    } catch (e) {
      console.warn(`[节假日] 同步异常（继续使用内置数据）：${e?.message || e}`);
    } finally {
      running = false;
    }
  };

  run();
  timer = setInterval(run, Math.max(1, intervalHours) * 3600 * 1000);
  timer.unref?.();
  return timer;
}
