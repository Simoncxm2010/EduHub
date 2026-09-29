import { Router } from 'express';
import { authRequired, adminOnly } from '../middleware.js';
import { h } from '../util.js';
import { HOLIDAYS, holidayMap, holidayRange, holidayLabel, syncedInfo } from '../holidays.js';
import { syncEnabled, syncHolidayYears, lastSyncResult, targetYears } from '../holiday-sync.js';
import { today } from '../db.js';

const router = Router();
router.use(authRequired);

/** 国家法定节假日与调休补班日（排课日历与智能排课提示用） */
router.get('/', h(async (req, res) => {
  const t = today();
  res.json({
    holidays: holidayMap,
    range: holidayRange(),
    meta: HOLIDAYS.map((h2) => ({ name: h2.name, count: h2.dates.length, workdays: h2.workdays.length })),
    today: { date: t, label: holidayLabel(t) },
    sync: { enabled: syncEnabled(), ...syncedInfo(), last: lastSyncResult() },
  });
}));

/** 手动触发同步（管理员）：外部源不可达时会明确告知失败原因，不影响内置数据 */
router.post('/refresh', adminOnly, h(async (req, res) => {
  if (!syncEnabled()) {
    return res.status(409).json({ message: '节假日自动同步已关闭（EDUHUB_HOLIDAY_SYNC=0）', sync: syncedInfo() });
  }
  const years = req.body?.years?.length ? req.body.years.map(Number).filter(Number.isInteger) : targetYears();
  const results = await syncHolidayYears(years, { force: req.body?.force !== false });
  const updated = results.filter((r) => r.status === 'updated');
  res.json({
    results,
    updated: updated.length,
    range: holidayRange(),
    sync: syncedInfo(),
    message: updated.length
      ? `已更新 ${updated.map((r) => r.year).join('、')} 年的节假日数据`
      : '没有可更新的数据（可能尚未公布，或数据源不可达）',
  });
}));

export default router;
