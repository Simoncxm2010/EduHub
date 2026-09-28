import { Router } from 'express';
import { db, today } from '../db.js';
import { authRequired, teacherOnly, studentOnly, assertClassAccess, roleAtLeast } from '../middleware.js';
import {
  h, ApiError, isDate, isTime, addDays, nowStamp, toMin, minToTime, weekdayOf, eachDate, csvCell,
} from '../util.js';
import { findConflicts, conflictText } from '../conflicts.js';

const router = Router();
router.use(authRequired);

const ATTEND_STATUSES = ['present', 'late', 'absent', 'leave'];
/** 学生自助签到可选的状态（缺勤由老师判定，学生不能自选） */
const SELF_STATUSES = ['present', 'late', 'leave'];
const STATUS_CN = { scheduled: '待上课', done: '已完成', canceled: '已取消' };

/** 只接受本站上传目录下的图片地址，避免把外部链接存进库 */
function normImage(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(s)) throw new ApiError(400, '图片地址不合法');
  return s;
}

/**
 * 找出该教师当天的排课冲突：
 * - type=class：同一班级时间重叠（同一个班不可能同时上两节课）
 * - type=room ：不同班级但同一教室时间重叠
 * 实现见 ../conflicts.js（申请审批也要用同一套判断）
 */

/** 可见范围：管理员看全部；教师看自己班级；学生看已加入班级 */
function lessonScope(user) {
  if (roleAtLeast(user, 'admin')) return { where: '1 = 1', params: [] };
  if (user.role === 'teacher') {
    return { where: 'l.class_id IN (SELECT id FROM classes WHERE teacher_id = ?)', params: [user.id] };
  }
  return { where: 'l.class_id IN (SELECT class_id FROM students WHERE user_id = ?)', params: [user.id] };
}

function lessonWithClass(user, id) {
  const scope = lessonScope(user);
  return db.prepare(`
    SELECT l.*, c.name AS class_name, c.color AS class_color, c.teacher_id
    FROM lessons l JOIN classes c ON c.id = l.class_id
    WHERE l.id = ? AND ${scope.where}
  `).get(id, ...scope.params);
}

/** 课时列表：?from=YYYY-MM-DD&to=YYYY-MM-DD&class_id=1 */
router.get('/', h(async (req, res) => {
  const scope = lessonScope(req.user);
  const conds = [scope.where];
  const params = [...scope.params];
  if (req.query.from && req.query.to) {
    if (!isDate(req.query.from) || !isDate(req.query.to)) throw new ApiError(400, '日期格式不正确');
    conds.push('l.date >= ? AND l.date <= ?');
    params.push(req.query.from, req.query.to);
  }
  if (req.query.class_id) {
    conds.push('l.class_id = ?');
    params.push(Number(req.query.class_id));
  }
  const rows = db.prepare(`
    SELECT l.*, c.name AS class_name, c.color AS class_color,
      (SELECT COUNT(*) FROM students s WHERE s.class_id = l.class_id) AS student_count,
      (SELECT COUNT(*) FROM attendance a WHERE a.lesson_id = l.id AND a.status IN ('present','late')) AS checked_count,
      (SELECT COUNT(*) FROM attendance a WHERE a.lesson_id = l.id AND a.signature IS NOT NULL) AS signed_count,
      CASE WHEN l.checkin_photo IS NOT NULL OR l.teacher_signature IS NOT NULL THEN 1 ELSE 0 END AS has_checkin
    FROM lessons l JOIN classes c ON c.id = l.class_id
    WHERE ${conds.join(' AND ')}
    ORDER BY l.date, l.start_time, l.id
  `).all(...params);
  res.json({ lessons: rows });
}));

/** 新建课时（教师），支持按周重复 repeat_weeks 次 */
router.post('/', teacherOnly, h(async (req, res) => {
  const { class_id, date, start_time, duration_min = 60, room = '', topic = '', repeat_weeks = 1 } = req.body || {};
  const cls = assertClassAccess(req.user, Number(class_id));
  if (!isDate(date)) throw new ApiError(400, '请选择上课日期');
  if (!isTime(start_time)) throw new ApiError(400, '请选择上课时间');
  const dur = Math.min(Math.max(Number(duration_min) || 60, 15), 480);
  const weeks = Math.min(Math.max(Number(repeat_weeks) || 1, 1), 16);
  const insert = db.prepare('INSERT INTO lessons (class_id, date, start_time, duration_min, room, topic) VALUES (?, ?, ?, ?, ?, ?)');
  const created = [];
  for (let i = 0; i < weeks; i++) {
    const r = insert.run(cls.id, addDays(date, i * 7), start_time, dur, String(room), String(topic));
    created.push(r.lastInsertRowid);
  }
  const lessons = created.map((id) => lessonWithClass(req.user, id));
  res.status(201).json({ lessons });
}));

/**
 * 单次排课冲突预检（新建/复制课时前调用）。
 * 注意：这条路由必须在 /:id 之前注册，否则会被 /:id 当成 id 捕获。
 */
router.get('/check', teacherOnly, h(async (req, res) => {
  const { date, start_time, duration_min = 60, room = '', class_id } = req.query;
  if (!isDate(date) || !isTime(start_time)) throw new ApiError(400, '日期或时间格式不正确');
  const conflicts = findConflicts(req.user.id, {
    class_id: Number(class_id) || null,
    date,
    start_time,
    duration_min: Number(duration_min) || 60,
    room: String(room || ''),
  }).map((c) => ({ type: c.type, text: conflictText(c), lesson: c.lesson }));
  res.json({ conflicts });
}));

/**
 * 智能排课建议：看这个班过去的排课规律，猜出常用的星期、时间、时长、教室。
 */
router.get('/smart/suggest', teacherOnly, h(async (req, res) => {
  const cls = assertClassAccess(req.user, Number(req.query.class_id));
  const rows = db.prepare(`
    SELECT date, start_time, duration_min, room FROM lessons
    WHERE class_id = ? AND status != 'canceled' ORDER BY date DESC LIMIT 40
  `).all(cls.id);
  if (!rows.length) return res.json({ suggestion: null });

  const tally = new Map();
  for (const r of rows) {
    const key = [weekdayOf(r.date), r.start_time, r.duration_min, r.room].join('|');
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  const [best, hits] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  const [weekday, startTime, duration, room] = best.split('|');
  res.json({
    suggestion: {
      weekdays: [Number(weekday)],
      start_time: startTime,
      duration_min: Number(duration),
      room,
      hits,
      sampled: rows.length,
    },
  });
}));

/**
 * 智能排课：按「每周哪几天 + 时间 + 日期范围」批量生成课时，
 * 自动跳过与已有课程冲突或老师手动排除的日期。
 * dry_run 为真时只返回计划，不写库（用于预览）。
 */
router.post('/smart/plan', teacherOnly, h(async (req, res) => {
  const b = req.body || {};
  const cls = assertClassAccess(req.user, Number(b.class_id));

  const weekdays = Array.isArray(b.weekdays)
    ? [...new Set(b.weekdays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))]
    : [];
  if (!weekdays.length) throw new ApiError(400, '请选择每周上课的日子');
  const { from, to } = b;
  if (!isDate(from) || !isDate(to)) throw new ApiError(400, '请选择日期范围');
  if (to < from) throw new ApiError(400, '结束日期不能早于开始日期');
  if (!isTime(b.start_time)) throw new ApiError(400, '请选择上课时间');

  const duration = Math.min(Math.max(Number(b.duration_min) || 60, 15), 480);
  const room = String(b.room || '');
  const topic = String(b.topic || '');
  const skipDates = new Set(Array.isArray(b.skip_dates) ? b.skip_dates.filter(isDate) : []);

  const dates = eachDate(from, to).filter((d) => weekdays.includes(weekdayOf(d)));
  if (dates.length > 200) throw new ApiError(400, '一次最多生成 200 节课，请缩短日期范围');

  const plan = dates.map((date) => {
    if (skipDates.has(date)) return { date, status: 'skip', reason: '已手动排除' };
    const conflicts = findConflicts(req.user.id, {
      class_id: cls.id, date, start_time: b.start_time, duration_min: duration, room,
    });
    if (conflicts.length) return { date, status: 'conflict', reason: conflictText(conflicts[0]) };
    return { date, status: 'ok', reason: '' };
  });

  const summary = {
    total: plan.length,
    ok: plan.filter((p) => p.status === 'ok').length,
    conflict: plan.filter((p) => p.status === 'conflict').length,
    skip: plan.filter((p) => p.status === 'skip').length,
  };

  if (b.dry_run !== false) return res.json({ plan, summary, settings: { from, to, start_time: b.start_time, duration_min: duration, room, topic, weekdays } });

  const insert = db.prepare('INSERT INTO lessons (class_id, date, start_time, duration_min, room, topic) VALUES (?, ?, ?, ?, ?, ?)');
  const createdIds = [];
  db.exec('BEGIN');
  try {
    for (const p of plan) {
      if (p.status !== 'ok') continue;
      createdIds.push(insert.run(cls.id, p.date, b.start_time, duration, room, topic).lastInsertRowid);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.status(201).json({
    created: createdIds.map((id) => lessonWithClass(req.user, id)),
    skipped: plan.filter((p) => p.status !== 'ok'),
    summary,
  });
}));

/** 导出课时与签到明细（CSV，带 BOM 以便 Excel 正确识别中文） */
router.get('/export/csv', h(async (req, res) => {
  const cls = assertClassAccess(req.user, Number(req.query.class_id));
  const from = isDate(req.query.from) ? req.query.from : '0000-01-01';
  const to = isDate(req.query.to) ? req.query.to : '9999-12-31';

  const lessons = db.prepare(`
    SELECT l.*, (SELECT content FROM lesson_records r WHERE r.lesson_id = l.id) AS content
    FROM lessons l WHERE l.class_id = ? AND l.date BETWEEN ? AND ?
    ORDER BY l.date, l.start_time
  `).all(cls.id, from, to);

  const marks = db.prepare(`
    SELECT a.lesson_id, a.status, a.signature FROM attendance a
    JOIN lessons l ON l.id = a.lesson_id WHERE l.class_id = ?
  `).all(cls.id);
  const byLesson = new Map();
  for (const m of marks) {
    const t = byLesson.get(m.lesson_id) || { present: 0, late: 0, absent: 0, leave: 0, signed: 0 };
    t[m.status] += 1;
    if (m.signature) t.signed += 1;
    byLesson.set(m.lesson_id, t);
  }

  const esc = csvCell;
  const header = ['日期', '星期', '开始', '结束', '班级', '教室', '主题', '状态', '出勤', '迟到', '缺勤', '请假', '已签名', '课堂记录'];
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const lines = [header.map(esc).join(',')];
  for (const l of lessons) {
    const t = byLesson.get(l.id) || { present: 0, late: 0, absent: 0, leave: 0, signed: 0 };
    lines.push([
      l.date, WEEK[weekdayOf(l.date)], l.start_time,
      minToTime(toMin(l.start_time) + l.duration_min),
      cls.name, l.room, l.topic, STATUS_CN[l.status] || l.status,
      t.present, t.late, t.absent, t.leave, t.signed,
      String(l.content || '').replace(/\s+/g, ' ').slice(0, 120),
    ].map(esc).join(','));
  }

  const stamp = from === '0000-01-01' ? '全部' : `${from}_${to}`;
  const filename = encodeURIComponent(`${cls.name}-课时签到记录-${stamp}.csv`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="eduhub-export.csv"; filename*=UTF-8''${filename}`);
  res.send('\uFEFF' + lines.join('\r\n'));
}));

/** 课时详情：名单 + 签到（含留痕） + 课堂记录 */
router.get('/:id', h(async (req, res) => {
  const lesson = lessonWithClass(req.user, Number(req.params.id));
  if (!lesson) throw new ApiError(404, '课时不存在');
  const teacher = db.prepare('SELECT name FROM users WHERE id = ?').get(lesson.teacher_id);
  const students = db.prepare('SELECT * FROM students WHERE class_id = ? ORDER BY created_at, id').all(lesson.class_id);
  let attendance = db.prepare(
    'SELECT student_id, status, signature, photo, signed_at, checked_at FROM attendance WHERE lesson_id = ?'
  ).all(lesson.id);

  // 学生只能看到自己的签名与照片，同学只给「是否已签」的状态
  if (req.user.role !== 'teacher') {
    const mine = students.find((s) => s.user_id === req.user.id)?.id ?? null;
    attendance = attendance.map((a) => (a.student_id === mine
      ? { ...a, signed: !!a.signature }
      : { student_id: a.student_id, status: a.status, checked_at: a.checked_at, signed: !!a.signature }));
  }

  const record = db.prepare('SELECT content, homework, updated_at FROM lesson_records WHERE lesson_id = ?').get(lesson.id) || null;
  res.json({ lesson, teacher, students, attendance, record });
}));

/** 更新课时（教师）：时间/地点/主题/状态 */
router.put('/:id', teacherOnly, h(async (req, res) => {
  const lesson = lessonWithClass(req.user, Number(req.params.id));
  if (!lesson) throw new ApiError(404, '课时不存在');
  const b = req.body || {};
  const date = b.date !== undefined ? b.date : lesson.date;
  const startTime = b.start_time !== undefined ? b.start_time : lesson.start_time;
  const duration = b.duration_min !== undefined ? b.duration_min : lesson.duration_min;
  if (!isDate(date)) throw new ApiError(400, '日期格式不正确');
  if (!isTime(startTime)) throw new ApiError(400, '时间格式不正确');
  const status = b.status !== undefined ? b.status : lesson.status;
  if (!['scheduled', 'done', 'canceled'].includes(status)) throw new ApiError(400, '状态不合法');
  db.prepare('UPDATE lessons SET date = ?, start_time = ?, duration_min = ?, room = ?, topic = ?, status = ? WHERE id = ?')
    .run(date, startTime, Math.min(Math.max(Number(duration) || 60, 15), 480),
      b.room !== undefined ? String(b.room) : lesson.room,
      b.topic !== undefined ? String(b.topic) : lesson.topic,
      status, lesson.id);
  res.json({ lesson: lessonWithClass(req.user, lesson.id) });
}));

/** 删除课时（教师） */
router.delete('/:id', teacherOnly, h(async (req, res) => {
  const lesson = lessonWithClass(req.user, Number(req.params.id));
  if (!lesson) throw new ApiError(404, '课时不存在');
  db.prepare('DELETE FROM lessons WHERE id = ?').run(lesson.id);
  res.json({ ok: true });
}));

/** 复制课时到另一天（教师）：沿用时间/时长/教室/主题，不带签到与留痕 */
router.post('/:id/duplicate', teacherOnly, h(async (req, res) => {
  const lesson = lessonWithClass(req.user, Number(req.params.id));
  if (!lesson) throw new ApiError(404, '课时不存在');
  const date = req.body?.date;
  if (!isDate(date)) throw new ApiError(400, '请选择要复制到的日期');
  const r = db.prepare(
    'INSERT INTO lessons (class_id, date, start_time, duration_min, room, topic) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(lesson.class_id, date, lesson.start_time, lesson.duration_min, lesson.room, lesson.topic);
  res.status(201).json({ lesson: lessonWithClass(req.user, r.lastInsertRowid) });
}));

/** 保存签到（教师）：整节课程的状态 + 签名/照片留痕 */
router.put('/:id/attendance', teacherOnly, h(async (req, res) => {
  const lesson = lessonWithClass(req.user, Number(req.params.id));
  if (!lesson) throw new ApiError(404, '课时不存在');
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const inClass = new Set(
    db.prepare('SELECT id FROM students WHERE class_id = ?').all(lesson.class_id).map((s) => s.id)
  );
  // 未显式提交签名/照片时沿用旧值，避免前端局部提交把留痕清掉
  const before = new Map(
    db.prepare('SELECT student_id, signature, photo, signed_at FROM attendance WHERE lesson_id = ?')
      .all(lesson.id).map((a) => [a.student_id, a])
  );
  const save = db.prepare(
    'INSERT INTO attendance (lesson_id, student_id, status, signature, photo, signed_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM attendance WHERE lesson_id = ?').run(lesson.id);
    for (const it of items) {
      const sid = Number(it?.student_id);
      if (!inClass.has(sid)) continue;
      if (!ATTEND_STATUSES.includes(it?.status)) throw new ApiError(400, '签到状态不合法');
      const prev = before.get(sid);
      const signature = 'signature' in it ? normImage(it.signature) : (prev?.signature ?? null);
      const photo = 'photo' in it ? normImage(it.photo) : (prev?.photo ?? null);
      const signedAt = signature ? (prev?.signed_at || nowStamp()) : null;
      save.run(lesson.id, sid, it.status, signature, photo, signedAt);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  const attendance = db.prepare(
    'SELECT student_id, status, signature, photo, signed_at, checked_at FROM attendance WHERE lesson_id = ?'
  ).all(lesson.id);
  res.json({ attendance });
}));

/** 课堂留痕（教师）：课堂照片 + 教师签名 */
router.put('/:id/checkin', teacherOnly, h(async (req, res) => {
  const lesson = lessonWithClass(req.user, Number(req.params.id));
  if (!lesson) throw new ApiError(404, '课时不存在');
  const b = req.body || {};
  const photo = 'checkin_photo' in b ? normImage(b.checkin_photo) : lesson.checkin_photo;
  const signature = 'teacher_signature' in b ? normImage(b.teacher_signature) : lesson.teacher_signature;
  db.prepare('UPDATE lessons SET checkin_photo = ?, teacher_signature = ?, checkin_at = ? WHERE id = ?')
    .run(photo, signature, photo || signature ? nowStamp() : null, lesson.id);
  res.json({ lesson: lessonWithClass(req.user, lesson.id) });
}));

/** 学生自助签到：拍照 + 手写签名（需在班级内） */
router.put('/:id/attendance/me', studentOnly, h(async (req, res) => {
  const lesson = lessonWithClass(req.user, Number(req.params.id));
  if (!lesson) throw new ApiError(404, '课时不存在');
  if (lesson.status === 'canceled') throw new ApiError(400, '本节课已取消，无需签到');
  const me = db.prepare('SELECT * FROM students WHERE class_id = ? AND user_id = ?').get(lesson.class_id, req.user.id);
  if (!me) throw new ApiError(403, '你不在该班级中');

  const { status, signature, photo } = req.body || {};
  if (!SELF_STATUSES.includes(status)) throw new ApiError(400, '请选择签到状态');
  const sig = normImage(signature);
  const pic = normImage(photo);
  if (status !== 'leave' && !sig) throw new ApiError(400, '请先手写签名再提交签到');

  const existing = db.prepare('SELECT id FROM attendance WHERE lesson_id = ? AND student_id = ?').get(lesson.id, me.id);
  if (existing) {
    db.prepare(`UPDATE attendance SET status = ?, signature = ?, photo = ?, signed_at = ?,
                checked_at = datetime('now','localtime') WHERE id = ?`)
      .run(status, sig, pic, sig ? nowStamp() : null, existing.id);
  } else {
    db.prepare('INSERT INTO attendance (lesson_id, student_id, status, signature, photo, signed_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(lesson.id, me.id, status, sig, pic, sig ? nowStamp() : null);
  }
  const mine = db.prepare(
    'SELECT student_id, status, signature, photo, signed_at, checked_at FROM attendance WHERE lesson_id = ? AND student_id = ?'
  ).get(lesson.id, me.id);
  res.json({ attendance: mine, student_id: me.id });
}));

/** 保存课堂记录（教师） */
router.put('/:id/record', teacherOnly, h(async (req, res) => {
  const lesson = lessonWithClass(req.user, Number(req.params.id));
  if (!lesson) throw new ApiError(404, '课时不存在');
  const content = String(req.body?.content ?? '');
  const homework = String(req.body?.homework ?? '');
  db.prepare(`
    INSERT INTO lesson_records (lesson_id, content, homework) VALUES (?, ?, ?)
    ON CONFLICT(lesson_id) DO UPDATE SET content = excluded.content, homework = excluded.homework, updated_at = datetime('now','localtime')
  `).run(lesson.id, content, homework);
  const record = db.prepare('SELECT content, homework, updated_at FROM lesson_records WHERE lesson_id = ?').get(lesson.id);
  res.json({ record });
}));

/** 首页概览：今日课程 + 统计 + 待处理申请 + 本月课酬 */
router.get('/dashboard/overview', h(async (req, res) => {
  const scope = lessonScope(req.user);
  const t = today();
  const day = new Date(`${t}T00:00:00`);
  const weekStart = addDays(t, -((day.getDay() + 6) % 7)); // 本周一（周日归到本周）
  const weekEnd = addDays(weekStart, 6);
  const month = t.slice(0, 7);

  const todayLessons = db.prepare(`
    SELECT l.*, c.name AS class_name, c.color AS class_color,
      (SELECT COUNT(*) FROM students s WHERE s.class_id = l.class_id) AS student_count,
      (SELECT COUNT(*) FROM attendance a WHERE a.lesson_id = l.id AND a.status IN ('present','late')) AS checked_count,
      (SELECT COUNT(*) FROM attendance a WHERE a.lesson_id = l.id AND a.signature IS NOT NULL) AS signed_count,
      CASE WHEN l.checkin_photo IS NOT NULL OR l.teacher_signature IS NOT NULL THEN 1 ELSE 0 END AS has_checkin
    FROM lessons l JOIN classes c ON c.id = l.class_id
    WHERE ${scope.where} AND l.date = ?
    ORDER BY l.start_time
  `).all(...scope.params, t);

  const weekLessons = () => db.prepare(
    `SELECT COUNT(*) AS n FROM lessons l WHERE ${scope.where} AND l.date BETWEEN ? AND ? AND l.status != 'canceled'`
  ).get(...scope.params, weekStart, weekEnd).n;

  let stats;
  if (roleAtLeast(req.user, 'admin')) {
    stats = {
      class_count: db.prepare('SELECT COUNT(*) AS n FROM classes').get().n,
      student_count: db.prepare('SELECT COUNT(*) AS n FROM students').get().n,
      teacher_count: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'teacher'").get().n,
      user_count: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      week_lessons: weekLessons(),
      pending_requests: db.prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'pending'").get().n,
    };
  } else if (req.user.role === 'teacher') {
    const income = db.prepare(`
      SELECT COALESCE(SUM(c.rate), 0) AS total, COUNT(*) AS n
      FROM lessons l JOIN classes c ON c.id = l.class_id
      WHERE c.teacher_id = ? AND l.status = 'done' AND l.date LIKE ?
    `).get(req.user.id, `${month}%`);
    stats = {
      class_count: db.prepare('SELECT COUNT(*) AS n FROM classes WHERE teacher_id = ?').get(req.user.id).n,
      student_count: db.prepare(
        'SELECT COUNT(DISTINCT name) AS n FROM students WHERE class_id IN (SELECT id FROM classes WHERE teacher_id = ?)'
      ).get(req.user.id).n,
      week_lessons: weekLessons(),
      month_done_lessons: income.n,
      month_income: Math.round(income.total * 100) / 100,
      pending_requests: db.prepare(
        "SELECT COUNT(*) AS n FROM requests WHERE teacher_id = ? AND status = 'pending'"
      ).get(req.user.id).n,
    };
  } else {
    stats = {
      class_count: db.prepare('SELECT COUNT(DISTINCT class_id) AS n FROM students WHERE user_id = ?').get(req.user.id).n,
      week_lessons: weekLessons(),
      my_pending: db.prepare(`
        SELECT COUNT(*) AS n FROM requests r JOIN students s ON s.id = r.student_id
        WHERE s.user_id = ? AND r.status = 'pending'
      `).get(req.user.id).n,
    };
  }

  res.json({ today: t, today_lessons: todayLessons, week_range: [weekStart, weekEnd], stats });
}));

/**
 * 批量改课时状态（教师）：放假 / 复课这类整段操作，
 * 比一节节点「取消课时」实用得多。
 */
router.post('/bulk-status', teacherOnly, h(async (req, res) => {
  const b = req.body || {};
  const cls = assertClassAccess(req.user, Number(b.class_id));
  const { from, to, status } = b;
  if (!isDate(from) || !isDate(to)) throw new ApiError(400, '请选择日期范围');
  if (to < from) throw new ApiError(400, '结束日期不能早于开始日期');
  if (!['scheduled', 'canceled'].includes(status)) throw new ApiError(400, '只能批量设为待上课或已取消');

  const targets = db.prepare(`
    SELECT id FROM lessons WHERE class_id = ? AND date BETWEEN ? AND ? AND status != ?
  `).all(cls.id, from, to, status);
  if (!targets.length) return res.json({ updated: 0, dates: [] });

  const upd = db.prepare('UPDATE lessons SET status = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const t of targets) upd.run(status, t.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  const dates = db.prepare(
    'SELECT date FROM lessons WHERE class_id = ? AND date BETWEEN ? AND ? ORDER BY date'
  ).all(cls.id, from, to).map((r) => r.date);
  res.json({ updated: targets.length, dates, status });
}));

export default router;
