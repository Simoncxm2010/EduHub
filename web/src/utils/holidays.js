import api from '../api';

/**
 * 国家法定节假日与调休补班日（前端缓存）。
 * date -> { name, type: 'holiday' | 'workday', source: 'builtin' | 'sync' }
 *
 * 服务端数据会被后台任务自动同步，所以这里不能永久缓存：
 * 正常情况缓存 12 小时；请求失败时保留旧数据，并安排 1 分钟后重试，
 * 避免一次网络抖动就把整个会话的节假日都变成空白。
 */
const TTL_MS = 12 * 3600 * 1000;
const RETRY_MS = 60 * 1000;

let holidayMap = null;
let syncInfo = null;
let fetchedAt = 0;
let pending = null;

export function holidayOf(date) {
  return holidayMap?.[date] ?? null;
}

/** 服务端同步状态（数据来源、最近同步时间），用于管理端展示 */
export function holidaySyncInfo() {
  return syncInfo;
}

/**
 * 确保节假日数据已加载。
 * @param force 忽略缓存强制重取（管理员手动同步后调用）
 */
export async function ensureHolidays(force = false) {
  if (!force && holidayMap && Date.now() - fetchedAt < TTL_MS) return holidayMap;
  if (pending) return pending;

  pending = api
    .get('/holidays')
    .then((d) => {
      holidayMap = d.holidays || {};
      syncInfo = d.sync || null;
      fetchedAt = Date.now();
      return holidayMap;
    })
    .catch(() => {
      if (!holidayMap) holidayMap = {};
      // 让缓存立刻「只剩 1 分钟有效期」，下次进入页面会重试
      fetchedAt = Date.now() - TTL_MS + RETRY_MS;
      return holidayMap;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}
