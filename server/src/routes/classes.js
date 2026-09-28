import { Router } from 'express';
import { db, today } from '../db.js';
import { authRequired, teacherOnly, studentOnly, assertClassAccess, roleAtLeast } from '../middleware.js';
import { h, ApiError, genInviteCode, pickColor } from '../util.js';

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

/** 班级详情（含学生名单） */
router.get('/:id', h(async (req, res) => {
  const cls = assertClassAccess(req.user, Number(req.params.id));
  const teacher = db.prepare('SELECT name, phone FROM users WHERE id = ?').get(cls.teacher_id);
  const students = db.prepare('SELECT * FROM students WHERE class_id = ? ORDER BY created_at, id').all(cls.id);
  const mine = req.user.role === 'student'
    ? db.prepare('SELECT id FROM students WHERE class_id = ? AND user_id = ?').get(cls.id, req.user.id)
    : null;
  res.json({ class: cls, teacher, students, my_student_id: mine?.id ?? null });
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
  const { name, phone = '', remark = '' } = req.body || {};
  if (!name || !String(name).trim()) throw new ApiError(400, '请填写学生姓名');
  const r = db.prepare('INSERT INTO students (class_id, name, phone, remark) VALUES (?, ?, ?, ?)')
    .run(cls.id, String(name).trim(), String(phone), String(remark));
  res.status(201).json({ student: db.prepare('SELECT * FROM students WHERE id = ?').get(r.lastInsertRowid) });
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

export default router;
