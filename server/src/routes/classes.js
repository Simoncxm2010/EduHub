import { Router } from 'express';
import { db, today } from '../db.js';
import { authRequired, teacherOnly, studentOnly, assertClassAccess, roleAtLeast } from '../middleware.js';
import { h, ApiError, genInviteCode, pickColor, csvCell } from '../util.js';
import { creditsOfClass } from '../credits.js';
import { owedByStudent } from '../makeups.js';

const router = Router();
router.use(authRequired);

/** 班级列表：教师返回自己创建的；学生返回已加入的；管理员返回全部 */
router.get('/', h(async (req, res) => {
  const base = `
    SELECT c.*,
      (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) AS student_count,
      (SELECT MIN(l.date) FROM lessons l WHERE l.class_id = c.id AND l.date >= ? AND l.status = 'scheduled') AS next_lesson_date,
      u.name AS teacher_name
    FROM classes c JOIN users u ON u.id = c.teacher_id`;
  if (roleAtLeast(req.user, 'admin')) {
    const rows = db.prepare(`${base} ORDER BY c.created_at DESC`).all(today());
    res.json({ classes: rows });
  } else if (req.user.role === 'teacher') {
    const rows = db.prepare(`${base} WHERE c.teacher_id = ? ORDER BY c.created_at DESC`).all(today(), req.user.id);
    res.json({ classes: rows });
  } else {
    const rows = db.prepare(`${base} JOIN students s ON s.class_id = c.id WHERE s.user_id = ? GROUP BY c.id ORDER BY c.created_at DESC`)
      .all(today(), req.user.id);
    res.json({ classes: rows });
  }
}));

/** 创建班级（教师），可设置每节课课酬用于统计 */
router.post('/', teacherOnly, h(async (req, res) => {
  const { name, subject = '', description = '', rate = 0 } = req.body || {};
  if (!name || !String(name).trim()) throw new ApiError(400, '请填写班级名称');
  const safeRate = Math.min(Math.max(Number(rate) || 0, 0), 1000000);
  const r = db.prepare(
    'INSERT INTO classes (teacher_id, name, subject, description, color, invite_code, rate) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, String(name).trim(), String(subject), String(description), pickColor(), genInviteCode(), safeRate);
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(r.lastInsertRowid);
  res.status(201).json({ class: cls });
}));

/** 学生凭邀请码加入班级 */
router.post('/join', studentOnly, h(async (req, res) => {
  const code = String(req.body?.invite_code || '').trim().toUpperCase();
  if (!code) throw new ApiError(400, '请填写邀请码');
  const cls = db.prepare('SELECT * FROM classes WHERE UPPER(invite_code) = ?').get(code);
  if (!cls) throw new ApiError(404, '邀请码无效');
  const existed = db.prepare('SELECT id FROM students WHERE class_id = ? AND user_id = ?').get(cls.id, req.user.id);
  if (existed) throw new ApiError(400, '你已加入该班级');
  db.prepare('INSERT INTO students (class_id, user_id, name, phone) VALUES (?, ?, ?, ?)')
    .run(cls.id, req.user.id, req.user.name, String(req.user.phone || ''));
  res.status(201).json({ class: cls });
}));

/** 班级详情（含学生名单、课时余额与欠课数） */
router.get('/:id', h(async (req, res) => {
  const cls = assertClassAccess(req.user, Number(req.params.id));
  const teacher = db.prepare('SELECT name, phone FROM users WHERE id = ?').get(cls.teacher_id);
  const students = db.prepare('SELECT * FROM students WHERE class_id = ? ORDER BY created_at, id').all(cls.id);

  // 课时余额与待补课数一次算完，避免前端逐个学生再问一遍
  const credits = creditsOfClass(cls.id);
  const owed = owedByStudent(cls.id);
  const withExtra = students.map((s) => ({
    ...s,
    credits: credits.get(s.id) || { lessons_total: 0, lessons_bonus: 0, used: 0, remaining: 0, low: false, owed: false },
    owed_makeups: owed.get(s.id) || 0,
  }));

  const mine = req.user.role === 'student'
    ? db.prepare('SELECT id FROM students WHERE class_id = ? AND user_id = ?').get(cls.id, req.user.id)
    : null;
  res.json({
    class: cls,
    teacher,
    students: withExtra,
    my_student_id: mine?.id ?? null,
    // 班里课时余额不足的人数，让老师一眼看到该提醒续费了
    low_credit_count: withExtra.filter((s) => s.credits.low).length,
  });
}));

/** 整班课时余额（课时包续费提醒用） */
router.get('/:id/credits', teacherOnly, h(async (req, res) => {
  const cls = assertClassAccess(req.user, Number(req.params.id));
  const students = db.prepare(
    'SELECT id, name, phone, guardian_phone, lessons_total, lessons_bonus FROM students WHERE class_id = ? ORDER BY created_at, id'
  ).all(cls.id);
  const credits = creditsOfClass(cls.id);
  const owed = owedByStudent(cls.id);
  const rows = students.map((s) => ({
    student_id: s.id,
    name: s.name,
    phone: s.phone,
    guardian_phone: s.guardian_phone,
    ...(credits.get(s.id) || { lessons_total: 0, lessons_bonus: 0, used: 0, remaining: 0, low: false, owed: false }),
    owed_makeups: owed.get(s.id) || 0,
  }));
  rows.sort((a, b) => a.remaining - b.remaining || a.name.localeCompare(b.name));
  res.json({ students: rows, low_credit_count: rows.filter((r) => r.low).length });
}));

/** 更新班级信息（教师） */
router.put('/:id', teacherOnly, h(async (req, res) => {
  const cls = assertClassAccess(req.user, Number(req.params.id));
  const { name = cls.name, subject = cls.subject, description = cls.description } = req.body || {};
  if (!String(name).trim()) throw new ApiError(400, '班级名称不能为空');
  const rate = req.body?.rate !== undefined
    ? Math.min(Math.max(Number(req.body.rate) || 0, 0), 1000000)
    : cls.rate;
  db.prepare('UPDATE classes SET name = ?, subject = ?, description = ?, rate = ? WHERE id = ?')
    .run(String(name).trim(), String(subject), String(description), rate, cls.id);
  res.json({ class: db.prepare('SELECT * FROM classes WHERE id = ?').get(cls.id) });
}));

/** 删除班级（教师） */
router.delete('/:id', teacherOnly, h(async (req, res) => {
  const cls = assertClassAccess(req.user, Number(req.params.id));
  db.prepare('DELETE FROM classes WHERE id = ?').run(cls.id);
  res.json({ ok: true });
}));

/** 添加学生（教师手动登记，可无账号） */
router.post('/:id/students', teacherOnly, h(async (req, res) => {
  const cls = assertClassAccess(req.user, Number(req.params.id));
  const { name, phone = '', remark = '', guardian_phone = '', lessons_total = 0, lessons_bonus = 0 } = req.body || {};
  if (!name || !String(name).trim()) throw new ApiError(400, '请填写学生姓名');
  const total = Math.min(Math.max(Number(lessons_total) || 0, 0), 10000);
  const bonus = Math.min(Math.max(Number(lessons_bonus) || 0, 0), 10000);
  const r = db.prepare(`
    INSERT INTO students (class_id, name, phone, guardian_phone, remark, lessons_total, lessons_bonus)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(cls.id, String(name).trim(), String(phone), String(guardian_phone), String(remark), total, bonus);
  res.status(201).json({ student: db.prepare('SELECT * FROM students WHERE id = ?').get(r.lastInsertRowid) });
}));

/** 修改学生资料与课时包（教师）：姓名、联系方式、购买/赠送节数 */
router.put('/:id/students/:sid', teacherOnly, h(async (req, res) => {
  const cls = assertClassAccess(req.user, Number(req.params.id));
  const cur = db.prepare('SELECT * FROM students WHERE id = ? AND class_id = ?').get(Number(req.params.sid), cls.id);
  if (!cur) throw new ApiError(404, '学生不存在');
  const b = req.body || {};
  const name = b.name === undefined ? cur.name : String(b.name).trim();
  if (!name) throw new ApiError(400, '学生姓名不能为空');
  const clamp = (v, fallback) => {
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new ApiError(400, '课时数必须是数字');
    // 负数直接拒绝而不是悄悄归零，否则前端传错只会看到余额莫名其妙变了
    if (n < 0) throw new ApiError(400, '课时数不能为负数');
    return Math.min(Math.round(n), 10000);
  };
  db.prepare(`
    UPDATE students SET name = ?, phone = ?, guardian_phone = ?, remark = ?,
      lessons_total = ?, lessons_bonus = ? WHERE id = ?
  `).run(
    name,
    b.phone === undefined ? cur.phone : String(b.phone),
    b.guardian_phone === undefined ? cur.guardian_phone : String(b.guardian_phone),
    b.remark === undefined ? cur.remark : String(b.remark),
    clamp(b.lessons_total, cur.lessons_total),
    clamp(b.lessons_bonus, cur.lessons_bonus),
    cur.id
  );
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(cur.id);
  const credits = creditsOfClass(cls.id).get(cur.id);
  res.json({ student, credits });
}));

/** 移除学生（教师） */
router.delete('/:id/students/:sid', teacherOnly, h(async (req, res) => {
  const cls = assertClassAccess(req.user, Number(req.params.id));
  db.prepare('DELETE FROM students WHERE id = ? AND class_id = ?').run(Number(req.params.sid), cls.id);
  res.json({ ok: true });
}));

/** 班级出勤统计（教师）：每个学生的出勤/迟到/缺勤/请假次数与出勤率 */
router.get('/:id/stats', teacherOnly, h(async (req, res) => {
  const cls = assertClassAccess(req.user, Number(req.params.id));
  const students = db.prepare('SELECT id, name, phone FROM students WHERE class_id = ? ORDER BY created_at, id').all(cls.id);
  const totalLessons = db.prepare(
    "SELECT COUNT(*) AS n FROM lessons WHERE class_id = ? AND status != 'canceled'"
  ).get(cls.id).n;

  const rows = db.prepare(`
    SELECT a.student_id, a.status, COUNT(*) AS n,
           SUM(CASE WHEN a.signature IS NOT NULL THEN 1 ELSE 0 END) AS signed
    FROM attendance a JOIN lessons l ON l.id = a.lesson_id
    WHERE l.class_id = ? AND l.status != 'canceled'
    GROUP BY a.student_id, a.status
  `).all(cls.id);

  const tally = new Map();
  for (const r of rows) {
    const t = tally.get(r.student_id) || { present: 0, late: 0, absent: 0, leave: 0, signed: 0 };
    t[r.status] += r.n;
    t.signed += r.signed;
    tally.set(r.student_id, t);
  }

  const stats = students.map((s) => {
    const t = tally.get(s.id) || { present: 0, late: 0, absent: 0, leave: 0, signed: 0 };
    const marked = t.present + t.late + t.absent + t.leave;
    return {
      ...s,
      ...t,
      marked,
      total_lessons: totalLessons,
      // 出勤率按「已记录」的课时算，没记录的课时不算缺勤
      rate: marked ? Math.round(((t.present + t.late) / marked) * 100) : null,
    };
  }).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.name.localeCompare(b.name, 'zh'));

  res.json({ total_lessons: totalLessons, stats });
}));

/** 按学生收费统计：某段时间内每个学生的出勤/请假/缺勤与应收金额 */
router.get('/:id/billing', teacherOnly, h(async (req, res) => {
  const cls = assertClassAccess(req.user, Number(req.params.id));
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? req.query.from : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? req.query.to : null;
  if (!from || !to || from > to) throw new ApiError(400, '请提供有效的 from/to 日期范围');

  // 计费口径：出勤（含迟到）才算钱；请假/缺勤不计费（机构普遍做法，缺勤也可在导出后手工调整）
  const students = db.prepare('SELECT id, name, phone, remark FROM students WHERE class_id = ? ORDER BY created_at, id').all(cls.id);
  const lessonRows = db.prepare(`
    SELECT l.id, l.date, l.start_time, l.duration_min, l.status FROM lessons l
    WHERE l.class_id = ? AND l.date BETWEEN ? AND ? AND l.status != 'canceled'
    ORDER BY l.date, l.start_time
  `).all(cls.id, from, to);

  const marks = db.prepare(`
    SELECT a.lesson_id, a.student_id, a.status FROM attendance a
    JOIN lessons l ON l.id = a.lesson_id
    WHERE l.class_id = ? AND l.date BETWEEN ? AND ? AND l.status != 'canceled'
  `).all(cls.id, from, to);

  const byStudent = new Map();
  for (const m of marks) {
    const t = byStudent.get(m.student_id) || { attended: 0, late: 0, leave: 0, absent: 0, unmarked: 0 };
    if (m.status === 'present') t.attended += 1;
    else if (m.status === 'late') { t.attended += 1; t.late += 1; }
    else if (m.status === 'leave') t.leave += 1;
    else if (m.status === 'absent') t.absent += 1;
    byStudent.set(m.student_id, t);
  }

  const rate = Number(cls.rate) || 0;
  const stats = students.map((s) => {
    const t = byStudent.get(s.id) || { attended: 0, late: 0, leave: 0, absent: 0, unmarked: 0 };
    const marked = t.attended + t.leave + t.absent;
    return {
      ...s,
      ...t,
      marked,
      unmarked: lessonRows.length - marked,
      amount: Math.round(t.attended * rate * 100) / 100,
    };
  }).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'zh'));

  res.json({
    class: { id: cls.id, name: cls.name, rate },
    range: [from, to],
    lesson_count: lessonRows.length,
    // 只统计已上完的课参与计费，未上的课不计
    done_lesson_count: lessonRows.filter((l) => l.status === 'done').length,
    total_amount: Math.round(stats.reduce((n, s) => n + s.amount, 0) * 100) / 100,
    stats,
  });
}));

/** 结算单 CSV 导出（带 BOM，Excel 直接打开） */
router.get('/:id/billing/export', teacherOnly, h(async (req, res) => {
  const cls = assertClassAccess(req.user, Number(req.params.id));
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? req.query.from : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? req.query.to : null;
  if (!from || !to || from > to) throw new ApiError(400, '请提供有效的 from/to 日期范围');

  const rate = Number(cls.rate) || 0;
  const students = db.prepare('SELECT id, name, phone FROM students WHERE class_id = ? ORDER BY created_at, id').all(cls.id);
  const lessonRows = db.prepare(`
    SELECT id, status FROM lessons l WHERE l.class_id = ? AND l.date BETWEEN ? AND ? AND l.status != 'canceled'
  `).all(cls.id, from, to);
  const marks = db.prepare(`
    SELECT a.student_id, a.status FROM attendance a
    JOIN lessons l ON l.id = a.lesson_id
    WHERE l.class_id = ? AND l.date BETWEEN ? AND ? AND l.status != 'canceled'
  `).all(cls.id, from, to);

  const byStudent = new Map();
  for (const m of marks) {
    const t = byStudent.get(m.student_id) || { attended: 0, leave: 0, absent: 0 };
    if (m.status === 'present' || m.status === 'late') t.attended += 1;
    else if (m.status === 'leave') t.leave += 1;
    else if (m.status === 'absent') t.absent += 1;
    byStudent.set(m.student_id, t);
  }

  const esc = csvCell;
  const lines = [
    ['学生', '手机号', '时段课次', '出勤', '请假', '缺勤', '未记录', '单节费用', '应收金额'].map(esc).join(','),
  ];
  let total = 0;
  for (const s of students) {
    const t = byStudent.get(s.id) || { attended: 0, leave: 0, absent: 0 };
    const amount = Math.round(t.attended * rate * 100) / 100;
    total += amount;
    lines.push([
      s.name, s.phone || '', lessonRows.length, t.attended, t.leave, t.absent,
      lessonRows.length - t.attended - t.leave - t.absent,
      rate, amount,
    ].map(esc).join(','));
  }
  lines.push(['合计', '', '', '', '', '', '', '', Math.round(total * 100) / 100].map(esc).join(','));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="eduhub-billing.csv"; filename*=UTF-8''${encodeURIComponent(`${cls.name}-收费结算-${from}_${to}.csv`)}`);
  res.send('\uFEFF' + lines.join('\r\n'));
}));

export default router;
