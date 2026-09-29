import { Router } from 'express';
import { db, today } from '../db.js';
import { authRequired, teacherOnly } from '../middleware.js';
import { h, ApiError, isDate, toMin, minToTime, eachDate, addDays } from '../util.js';

const router = Router();
// 教室占用属于排课运营信息（谁在用哪间教室），仅教师及以上可见
router.use(authRequired, teacherOnly);

/** 一次最多看两周：教室是按天共享的，再长的区间在界面上也读不过来 */
const MAX_DAYS = 14;

/** 规范化查询区间：默认今天，超长自动截断到 14 天 */
function rangeOf(query) {
  const from = query.from || today();
  const to = query.to || from;
  if (!isDate(from) || !isDate(to)) throw new ApiError(400, '日期格式不正确');
  if (from > to) throw new ApiError(400, '起始日期不能晚于结束日期');
  // 超长区间直接截断而不报错：老师往往手一滑就选了一整个月
  const days = eachDate(from, to);
  if (days.length > MAX_DAYS) return { from, to: addDays(from, MAX_DAYS - 1), clamped: true };
  return { from, to, clamped: false };
}

/** 两节课的时间区间是否有交集（[start, end) 半开区间，首尾相接不算冲突） */
function overlaps(a, b) {
  const aStart = toMin(a.start_time);
  const bStart = toMin(b.start_time);
  return aStart < bStart + b.duration_min && bStart < aStart + a.duration_min;
}

/**
 * 教室占用视图：?from=YYYY-MM-DD&to=YYYY-MM-DD（默认今天 .. 今天，最长 14 天）。
 *
 * 只统计填了教室、且没被取消的课时；同一间教室同一天时间重叠的两节课会被标成冲突，
 * 让「这间教室什么时候空着」和「哪两节课撞了」在同一个页面里看明白。
 */
router.get('/', h(async (req, res) => {
  const { from, to, clamped } = rangeOf(req.query);

  const rows = db.prepare(`
    SELECT l.id, l.date, l.start_time, l.duration_min, l.room, l.status,
           l.class_id, c.name AS class_name, c.color AS class_color, u.name AS teacher_name
    FROM lessons l
    JOIN classes c ON c.id = l.class_id
    LEFT JOIN users u ON u.id = c.teacher_id
    WHERE l.room != '' AND l.status != 'canceled' AND l.date BETWEEN ? AND ?
    ORDER BY l.room, l.date, l.start_time, l.id
  `).all(from, to);

  /** 教室名 -> 日期 -> 当天的课（已按开始时间排好） */
  const byRoom = new Map();
  for (const r of rows) {
    const lesson = {
      id: r.id,
      date: r.date,
      start_time: r.start_time,
      end_time: minToTime(toMin(r.start_time) + r.duration_min),
      duration_min: r.duration_min,
      class_id: r.class_id,
      class_name: r.class_name,
      class_color: r.class_color,
      teacher_name: r.teacher_name || '',
      status: r.status,
      conflict: false,
    };
    if (!byRoom.has(r.room)) byRoom.set(r.room, new Map());
    const byDate = byRoom.get(r.room);
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(lesson);
  }

  /** 冲突清单（教室 + 日期 + 撞在一起的课时），同时汇总到 summary */
  const conflicts = [];
  const rooms = [];
  for (const [name, byDate] of byRoom) {
    const days = [];
    let conflictCount = 0;
    for (const [date, lessons] of byDate) {
      const dayConflicts = [];
      for (let i = 0; i < lessons.length; i++) {
        for (let j = i + 1; j < lessons.length; j++) {
          const a = lessons[i];
          const b = lessons[j];
          if (!overlaps(a, b)) continue;
          a.conflict = true;
          b.conflict = true;
          dayConflicts.push({ lesson_ids: [a.id, b.id] });
        }
      }
      if (dayConflicts.length) {
        conflictCount += dayConflicts.length;
        // 一节课和好几节撞上时只列一次 id，前端照着标红就够了
        conflicts.push({ room: name, date, lesson_ids: [...new Set(dayConflicts.flatMap((c) => c.lesson_ids))] });
      }
      days.push({ date, lessons, conflicts: dayConflicts, conflict: dayConflicts.length > 0 });
    }
    rooms.push({
      name,
      lesson_count: days.reduce((n, d) => n + d.lessons.length, 0),
      day_count: days.length,
      conflict_count: conflictCount,
      has_conflict: conflictCount > 0,
      days,
    });
  }

  res.json({
    range: [from, to],
    // 区间被截断过时前端提示一句，免得老师以为查的是自己填的范围
    clamped,
    days: eachDate(from, to),
    rooms,
    summary: {
      room_count: rooms.length,
      lesson_count: rows.length,
      day_count: eachDate(from, to).length,
      // 撞车处数按「两两重叠」算，和每间教室的 conflict_count 口径一致
      conflict_count: rooms.reduce((n, r) => n + r.conflict_count, 0),
      conflicts,
    },
  });
}));

export default router;
