import { Router } from 'express';
import { db, today } from '../db.js';
import { authRequired, teacherOnly, assertClassAccess, roleAtLeast } from '../middleware.js';
import { h, ApiError, isTime, toMin, eachDate, weekdayOf, minToTime } from '../util.js';

const router = Router();
router.use(authRequired);

const MAX_WINDOWS = 40;
const SLOT_STEP = 30; // 匹配粒度：半小时

function listWindows(userId) {
  return db.prepare(
    'SELECT id, weekday, start_time, end_time, note FROM availability WHERE user_id = ? ORDER BY weekday, start_time'
  ).all(userId);
}

/** 我的可上课 / 可授课时段 */
router.get('/', h(async (req, res) => {
  const targetId = req.query.user_id ? Number(req.query.user_id) : req.user.id;
  if (targetId !== req.user.id) {
    // 老师可以看自己学生的时段，管理员可看全部
    const allowed = roleAtLeast(req.user, 'admin')
      || (req.user.role === 'teacher'
        && db.prepare(`
             SELECT 1 FROM students s JOIN classes c ON c.id = s.class_id
             WHERE s.user_id = ? AND c.teacher_id = ?
           `).get(targetId, req.user.id));
    if (!allowed) throw new ApiError(403, '无权查看该用户的时段');
  }
  res.json({ windows: listWindows(targetId), user_id: targetId });
}));

/** 覆盖式保存我的时段 */
router.put('/', h(async (req, res) => {
  const items = Array.isArray(req.body?.windows) ? req.body.windows : [];
  if (items.length > MAX_WINDOWS) throw new ApiError(400, `最多设置 ${MAX_WINDOWS} 个时段`);

  const cleaned = [];
  for (const it of items) {
    const weekday = Number(it?.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new ApiError(400, '星期不正确');
    if (!isTime(it?.start_time) || !isTime(it?.end_time)) throw new ApiError(400, '时间格式不正确');
    if (toMin(it.start_time) >= toMin(it.end_time)) throw new ApiError(400, '开始时间必须早于结束时间');
    cleaned.push({ weekday, start_time: it.start_time, end_time: it.end_time, note: String(it.note || '').slice(0, 60) });
  }

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM availability WHERE user_id = ?').run(req.user.id);
    const ins = db.prepare(
      'INSERT INTO availability (user_id, weekday, start_time, end_time, note) VALUES (?, ?, ?, ?, ?)'
    );
    for (const c of cleaned) ins.run(req.user.id, c.weekday, c.start_time, c.end_time, c.note);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ windows: listWindows(req.user.id) });
}));

/** 某班学生的时段概览（教师在协调时间时参考） */
router.get('/class/:id', teacherOnly, h(async (req, res) => {
  const cls = assertClassAccess(req.user, Number(req.params.id));
  const students = db.prepare(
    'SELECT id, name, user_id FROM students WHERE class_id = ? ORDER BY created_at, id'
  ).all(cls.id);
  const out = students.map((s) => ({
    student_id: s.id,
    name: s.name,
    windows: s.user_id ? listWindows(s.user_id) : [],
  }));
  res.json({ students: out });
}));

/** 把「分钟区间」按半小时粒度展开成若干起始分钟 */
function slotStarts(fromMin, toMinute, duration) {
  const out = [];
  const first = Math.ceil(fromMin / SLOT_STEP) * SLOT_STEP;
  for (let m = first; m + duration <= toMinute; m += SLOT_STEP) out.push(m);
  return out;
}

/**
 * 智能协调时间：找出「老师有空 + 学生有空 + 没有排课冲突」的时段。
 * - 教师调用：返回全班的候选时段，按「有空的学生数」降序，用于一键排课
 * - 学生调用：返回自己有空且老师有空的时段，可用于发起预约
 */
router.get('/match', h(async (req, res) => {
  const classId = Number(req.query.class_id);
  const cls = assertClassAccess(req.user, classId);
  const duration = Math.min(Math.max(Number(req.query.duration_min) || 90, 15), 480);
  const from = req.query.from || today();
  const to = req.query.to || from;
  const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 60);
  const room = String(req.query.room || '');
  const ignoreTeacherAvailability = req.query.ignore_teacher_availability === '1';

  // 老师自己的可授课时段（勾选了忽略时按全天 08:00-22:00 处理）
  const teacherId = cls.teacher_id;
  const teacherWindows = ignoreTeacherAvailability
    ? [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start_time: '08:00', end_time: '22:00' }))
    : listWindows(teacherId);

  const students = db.prepare(
    'SELECT id, name, user_id FROM students WHERE class_id = ? ORDER BY created_at, id'
  ).all(cls.id);
  const studentWindows = new Map(
    students.map((s) => [s.id, s.user_id ? listWindows(s.user_id) : []])
  );

  const isTeacherView = req.user.role === 'teacher' ? cls.teacher_id === req.user.id : roleAtLeast(req.user, 'admin');
  // 学生视角只看自己那份时段
  const myStudent = isTeacherView
    ? null
    : students.find((s) => s.user_id === req.user.id);
  if (!isTeacherView && !myStudent) throw new ApiError(403, '你不在该班级中');

  // 该教师这段时间的排课，用于排除冲突
  const busy = db.prepare(`
    SELECT l.date, l.start_time, l.duration_min, l.room, l.class_id
    FROM lessons l JOIN classes c ON c.id = l.class_id
    WHERE c.teacher_id = ? AND l.date BETWEEN ? AND ? AND l.status != 'canceled'
  `).all(teacherId, from, to);
  const busyByDate = new Map();
  for (const b of busy) {
    const list = busyByDate.get(b.date) || [];
    list.push({ start: toMin(b.start_time), end: toMin(b.start_time) + b.duration_min, room: b.room, class_id: b.class_id });
    busyByDate.set(b.date, list);
  }

  const results = [];
  for (const date of eachDate(from, to)) {
    const weekday = weekdayOf(date);
    const dayBusy = busyByDate.get(date) || [];

    // 老师这一天的可用区间
    const windows = teacherWindows.filter((w) => w.weekday === weekday);
    if (!windows.length) continue;

    for (const w of windows) {
      for (const start of slotStarts(toMin(w.start_time), toMin(w.end_time), duration)) {
        const end = start + duration;

        // 与已有排课冲突（本班或同教室）就跳过
        const clash = dayBusy.some((b) =>
          b.start < end && start < b.end && (b.class_id === cls.id || (room && b.room && b.room === room)));
        if (clash) continue;

        // 统计这个时段有多少学生有空
        let freeCount = 0;
        const freeNames = [];
        const busyNames = [];
        for (const s of students) {
          const wins = studentWindows.get(s.id) || [];
          const free = wins.some((x) => x.weekday === weekday && toMin(x.start_time) <= start && toMin(x.end_time) >= end);
          if (free) { freeCount++; freeNames.push(s.name); } else busyNames.push(s.name);
        }

        if (!isTeacherView && myStudent) {
          // 学生只关心自己是否有空
          if (!freeNames.includes(myStudent.name)) continue;
        }

        results.push({
          date,
          start_time: minToTime(start),
          end_time: minToTime(end),
          duration_min: duration,
          weekday,
          free_count: freeCount,
          total_students: students.length,
          free_names: freeNames,
          busy_names: busyNames,
        });
      }
    }
  }

  // 有空学生越多越优先，其次时间越早越优先
  results.sort((a, b) => b.free_count - a.free_count || a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));

  res.json({
    class: { id: cls.id, name: cls.name, color: cls.color },
    duration_min: duration,
    range: [from, to],
    // 没有学生填过时段时给出提示，避免老师误以为「一个都不合适」
    students_with_windows: students.filter((s) => (studentWindows.get(s.id) || []).length).length,
    total_students: students.length,
    slots: results.slice(0, limit),
    total_slots: results.length,
    scope: isTeacherView ? 'class' : 'me',
  });
}));

export default router;
