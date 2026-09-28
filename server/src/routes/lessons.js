import { Router } from 'express';
import { db, today } from '../db.js';
import { authRequired, teacherOnly, studentOnly, assertClassAccess } from '../middleware.js';
import { h, ApiError, isDate, isTime, addDays, nowStamp } from '../util.js';

const router = Router();
router.use(authRequired);

const ATTEND_STATUSES = ['present', 'late', 'absent', 'leave'];
/** 学生自助签到可选的状态（缺勤由老师判定，学生不能自选） */
const SELF_STATUSES = ['present', 'late', 'leave'];

/** 只接受本站上传目录下的图片地址，避免把外部链接存进库 */
function normImage(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(s)) throw new ApiError(400, '图片地址不合法');
  return s;
}

function lessonScope(user) {
  return user.role === 'teacher'
    ? { where: 'l.class_id IN (SELECT id FROM classes WHERE teacher_id = ?)', param: user.id }
    : { where: "l.class_id IN (SELECT class_id FROM students WHERE user_id = ? AND user_id IS NOT NULL)", param: user.id };
}

function lessonWithClass(user, id) {
  const scope = lessonScope(user);
  return db.prepare(`
    SELECT l.*, c.name AS class_name, c.color AS class_color, c.teacher_id
    FROM lessons l JOIN classes c ON c.id = l.class_id
    WHERE l.id = ? AND ${scope.where}
  `).get(id, scope.param);
}

/** 课时列表：?from=YYYY-MM-DD&to=YYYY-MM-DD&class_id=1 */
router.get('/', h(async (req, res) => {
  const scope = lessonScope(req.user);
  const conds = [scope.where];
  const params = [scope.param];
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

/** 首页概览：今日课程 + 统计 */
router.get('/dashboard/overview', h(async (req, res) => {
  const scope = lessonScope(req.user);
  const t = today();
  const day = new Date(`${t}T00:00:00`);
  const weekStart = addDays(t, -((day.getDay() + 6) % 7)); // 本周一（周日归到本周）
  const weekEnd = addDays(weekStart, 6);

  const todayLessons = db.prepare(`
    SELECT l.*, c.name AS class_name, c.color AS class_color,
      (SELECT COUNT(*) FROM students s WHERE s.class_id = l.class_id) AS student_count,
      (SELECT COUNT(*) FROM attendance a WHERE a.lesson_id = l.id AND a.status IN ('present','late')) AS checked_count,
      (SELECT COUNT(*) FROM attendance a WHERE a.lesson_id = l.id AND a.signature IS NOT NULL) AS signed_count,
      CASE WHEN l.checkin_photo IS NOT NULL OR l.teacher_signature IS NOT NULL THEN 1 ELSE 0 END AS has_checkin
    FROM lessons l JOIN classes c ON c.id = l.class_id
    WHERE ${scope.where} AND l.date = ?
    ORDER BY l.start_time
  `).all(scope.param, t);

  let stats;
  if (req.user.role === 'teacher') {
    stats = {
      class_count: db.prepare('SELECT COUNT(*) AS n FROM classes WHERE teacher_id = ?').get(req.user.id).n,
      student_count: db.prepare(
        'SELECT COUNT(DISTINCT name) AS n FROM students WHERE class_id IN (SELECT id FROM classes WHERE teacher_id = ?)'
      ).get(req.user.id).n,
      week_lessons: db.prepare(`SELECT COUNT(*) AS n FROM lessons l WHERE ${scope.where} AND l.date BETWEEN ? AND ? AND l.status != 'canceled'`)
        .get(scope.param, weekStart, weekEnd).n
    };
  } else {
    stats = {
      class_count: db.prepare('SELECT COUNT(DISTINCT class_id) AS n FROM students WHERE user_id = ?').get(req.user.id).n,
      week_lessons: db.prepare(`SELECT COUNT(*) AS n FROM lessons l WHERE ${scope.where} AND l.date BETWEEN ? AND ? AND l.status != 'canceled'`)
        .get(scope.param, weekStart, weekEnd).n
    };
  }
  res.json({ today: t, today_lessons: todayLessons, week_range: [weekStart, weekEnd], stats });
}));

export default router;
