/**
 * 国家法定节假日与调休补班日。
 *
 * 数据来源分两层：
 * 1. 内置兜底表 HOLIDAYS —— 依据国务院办公厅公布的通知整理，离线也能用；
 * 2. 同步层（holiday_sync 表）—— 由 holiday-sync.js 从外部数据源抓取并落库，
 *    同一自然年的数据会**整体覆盖**内置表，避免新旧两套日期混在一起。
 *
 * 对外统一暴露 holidayMap：date -> { name, type: 'holiday' | 'workday', source }。
 * 该对象的引用始终不变（同步后原地更新），调用方可以直接长期持有。
 */
import { db } from './db.js';

export const HOLIDAYS = [
  {
    name: '元旦',
    dates: ['2025-01-01'],
    workdays: [],
  },
  {
    name: '春节',
    dates: [
      '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31',
      '2025-02-01', '2025-02-02', '2025-02-03', '2025-02-04',
    ],
    workdays: ['2025-01-26', '2025-02-08'],
  },
  {
    name: '清明节',
    dates: ['2025-04-04', '2025-04-05', '2025-04-06'],
    workdays: [],
  },
  {
    name: '劳动节',
    dates: ['2025-05-01', '2025-05-02', '2025-05-03', '2025-05-04', '2025-05-05'],
    workdays: ['2025-04-27'],
  },
  {
    name: '端午节',
    dates: ['2025-05-31', '2025-06-01', '2025-06-02'],
    workdays: [],
  },
  {
    name: '国庆节·中秋节',
    dates: [
      '2025-10-01', '2025-10-02', '2025-10-03', '2025-10-04',
      '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08',
    ],
    workdays: ['2025-09-28', '2025-10-11'],
  },
  // ↓ 2026 年依据国办发明电〔2025〕7 号（2025-11-04 公布）
  {
    name: '元旦',
    dates: ['2026-01-01', '2026-01-02', '2026-01-03'],
    workdays: ['2026-01-04'],
  },
  {
    name: '春节',
    dates: [
      '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18',
      '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22',
      '2026-02-23',
    ],
    workdays: ['2026-02-14', '2026-02-28'],
  },
  {
    name: '清明节',
    dates: ['2026-04-04', '2026-04-05', '2026-04-06'],
    workdays: [],
  },
  {
    name: '劳动节',
    dates: ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05'],
    workdays: ['2026-05-09'],
  },
  {
    name: '端午节',
    dates: ['2026-06-19', '2026-06-20', '2026-06-21'],
    workdays: [],
  },
  {
    name: '中秋节',
    dates: ['2026-09-25', '2026-09-26', '2026-09-27'],
    workdays: [],
  },
  {
    name: '国庆节',
    dates: [
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
      '2026-10-05', '2026-10-06', '2026-10-07',
    ],
    workdays: ['2026-09-20', '2026-10-10'],
  },
  // ↓ 2027 年安排尚未公布（通常当年 11 月发布），此处仅按 1 月 1 日为周五推算，
  //   属于占位数据，同步到官方数据后会被自动覆盖。
  {
    name: '元旦',
    dates: ['2027-01-01', '2027-01-02', '2027-01-03'],
    workdays: [],
    estimated: true,
  },
];

/** 内置表覆盖的年份，用于判断某年的数据是否只是占位 */
const BUILTIN_ESTIMATED_YEARS = new Set(
  HOLIDAYS.filter((h) => h.estimated).flatMap((h) => h.dates.map((d) => d.slice(0, 4)))
);

/**
 * date -> { name, type: 'holiday' | 'workday', source: 'builtin' | 'sync' }
 * 引用恒定，内容由 rebuildMap() 原地更新。
 */
export const holidayMap = {};

/** 同步数据：year -> { source, fetched_at, holidays: [{ name, dates, workdays }] } */
const syncedYears = new Map();
let cachedRange = ['', ''];

/** 用内置表 + 同步数据重建索引 */
function rebuildMap() {
  const next = {};

  const put = (date, value) => {
    next[date] = value;
  };

  for (const h of HOLIDAYS) {
    for (const d of h.dates) put(d, { name: h.name, type: 'holiday', source: 'builtin' });
    for (const d of h.workdays) put(d, { name: h.name, type: 'workday', source: 'builtin' });
  }

  // 同步数据按年整体覆盖内置表：官方数据比内置表新，且避免同一天出现两种说法
  for (const [year, entry] of syncedYears) {
    for (const date of Object.keys(next)) {
      if (date.startsWith(`${year}-`)) delete next[date];
    }
    for (const h of entry.holidays) {
      for (const d of h.dates) put(d, { name: h.name, type: 'holiday', source: 'sync' });
      for (const d of h.workdays) put(d, { name: h.name, type: 'workday', source: 'sync' });
    }
  }

  for (const key of Object.keys(holidayMap)) delete holidayMap[key];
  Object.assign(holidayMap, next);

  const dates = Object.keys(holidayMap).sort();
  cachedRange = dates.length ? [dates[0], dates[dates.length - 1]] : ['', ''];
}

/** 从库里读出已同步的年份（启动时调用一次） */
export function loadSyncedHolidays() {
  syncedYears.clear();
  const rows = db.prepare('SELECT year, payload, source, fetched_at FROM holiday_sync').all();
  for (const row of rows) {
    try {
      const holidays = JSON.parse(row.payload);
      if (Array.isArray(holidays) && holidays.length) {
        syncedYears.set(row.year, { holidays, source: row.source, fetched_at: row.fetched_at });
      }
    } catch {
      // 脏数据直接忽略，回退到内置表，不影响排课
    }
  }
  rebuildMap();
}

/** 写入某一年的同步结果并立即生效 */
export function saveSyncedYear(year, holidays, source) {
  const payload = JSON.stringify(holidays);
  db.prepare(`
    INSERT INTO holiday_sync (year, payload, source, fetched_at) VALUES (?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(year) DO UPDATE SET payload = excluded.payload, source = excluded.source,
      fetched_at = excluded.fetched_at
  `).run(String(year), payload, String(source || ''));
  syncedYears.set(String(year), {
    holidays,
    source: String(source || ''),
    fetched_at: new Date().toLocaleString('sv-SE').slice(0, 19),
  });
  rebuildMap();
}

export function getHoliday(date) {
  return holidayMap[date] ?? null;
}

export function getAllHolidays() {
  return holidayMap;
}

/** 节假日数据覆盖的日期范围 [最早, 最晚] */
export function holidayRange() {
  return cachedRange;
}

/** 是否法定放假日（调休补班日不算） */
export function isHoliday(date) {
  return holidayMap[date]?.type === 'holiday';
}

/** 某天的中文说明，如「国庆节」「国庆节（补班）」；普通日返回 '' */
export function holidayLabel(date) {
  const h = holidayMap[date];
  if (!h) return '';
  return h.type === 'workday' ? `${h.name}（补班）` : h.name;
}

/** 已同步年份的概况（给管理端与接口展示用） */
export function syncedInfo() {
  const years = [...syncedYears.entries()]
    .map(([year, e]) => ({
      year,
      source: e.source,
      fetched_at: e.fetched_at,
      holiday_days: e.holidays.reduce((n, h) => n + h.dates.length, 0),
      workdays: e.holidays.reduce((n, h) => n + h.workdays.length, 0),
    }))
    .sort((a, b) => a.year.localeCompare(b.year));
  return {
    years,
    builtin_years: [...new Set(HOLIDAYS.flatMap((h) => h.dates.map((d) => d.slice(0, 4))))].sort(),
    estimated_years: [...BUILTIN_ESTIMATED_YEARS].sort(),
  };
}

/** 把范围内连续的放假日合并成「假期段」，便于生成整段日历事件 */
export function holidayRuns(from, to) {
  const dates = Object.keys(holidayMap)
    .filter((d) => d >= from && d <= to)
    .sort();
  const runs = [];
  for (const date of dates) {
    const info = holidayMap[date];
    const last = runs[runs.length - 1];
    const contiguous = last && info.type === last.type && info.name === last.name
      && nextDay(last.to) === date;
    if (contiguous) last.to = date;
    else runs.push({ from: date, to: date, name: info.name, type: info.type });
  }
  return runs;
}

function nextDay(date) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA');
}

// 模块加载时先应用库里已有的同步数据（没有则用内置表）
loadSyncedHolidays();
