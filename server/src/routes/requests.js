import { Router } from 'express';
import { db, today } from '../db.js';
import { authRequired, teacherOnly, roleAtLeast } from '../middleware.js';
import { h, ApiError, isDate, isTime, nowStamp, toMin, minToTime } from '../util.js';
import { findConflicts, conflictText } from '../conflicts.js';
import { notify } from './notifications.js';

const router = Router();
router.use(authRequired);

const KINDS = ['leave', 'booking'];
const PENDING = 'pending';

function requestRow(id) {
  return db.prepare(`
    SELECT r.*, c.name AS class_name, c.color AS class_color, s.name AS student_name,
           u.name AS decided_by_name
    FROM requests r
    JOIN classes c ON c.id = r.class_id
    JOIN students s ON s.id = r.student_id
    LEFT JOIN users u ON u.id = r.decided_by
    WHERE r.id = ?
  `).get(id);
}

/** 当前用户对应的学生档案（可能为 null） */
function myStudentRows(userId) {
  return db.prepare('SELECT * FROM students WHERE user_id = ?').all(userId);
}

/**
 * 申请列表：
 * - 学生：自己提交的
 * - 教师：自己班级收到的
 * - 管理员：全部
 */
router.get('/', h(async (req, res) => {
  const status = req.query.status;
  const conds = [];
  const params = [];

  if (roleAtLeast(req.user, 'admin')) {
    // 不加限制
  } else if (req.user.role === 'teacher') {
    conds.push('r.teacher_id = ?');
    params.push(req.user.id);
  } else {
    conds.push('s.user_id = ?');
    params.push(req.user.id);
  }

  if (status && ['pending', 'approved', 'rejected', 'canceled'].includes(status)) {
    conds.push('r.status = ?');
    params.push(status);
  }
  if (req.query.kind && KINDS.includes(req.query.kind)) {
    conds.push('r.kind = ?');
    params.push(req.query.kind);
  }
  if (req.query.class_id) {
    conds.push('r.class_id = ?');
    params.push(Number(req.query.class_id));
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT r.*, c.name AS class_name, c.color AS class_color, s.name AS student_name,
           u.name AS decided_by_name
    FROM requests r
    JOIN classes c ON c.id = r.class_id
    JOIN students s ON s.id = r.student_id
    LEFT JOIN users u ON u.id = r.decided_by
    ${where}
    ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.date DESC, r.id DESC
    LIMIT 200
  `).all(...params);

  const isAdmin = roleAtLeast(req.user, 'admin');
  const pendingCount = isAdmin
    ? db.prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'pending'").get().n
    : req.user.role === 'teacher'
      ? db.prepare("SELECT COUNT(*) AS n FROM requests WHERE teacher_id = ? AND status = 'pending'").get(req.user.id).n
      : db.prepare(`
          SELECT COUNT(*) AS n FROM requests r JOIN students s ON s.id = r.student_id
          WHERE s.user_id = ? AND r.status = 'pending'
        `).get(req.user.id).n;

  res.json({ requests: rows, pending_count: pendingCount });
}));

/**
 * 提交申请（学生）
 * - kind=leave  ：对某节课请假，需带 lesson_id
 * - kind=booking：预约一节课，需带 date / start_time / duration_min
 */
router.post('/', h(async (req, res) => {
  const b = req.body || {};
  const kind = String(b.kind || '');
  if (!KINDS.includes(kind)) throw new ApiError(400, '申请类型不正确');

  const mine = myStudentRows(req.user.id);
  if (!mine.length) throw new ApiError(403, '只有已加入班级的学生才能提交申请');

  const wantLesson = kind === 'leave' ? db.prepare(`
    SELECT l.*, c.teacher_id FROM lessons l JOIN classes c ON c.id = l.class_id WHERE l.id = ?
  `).get(Number(b.lesson_id)) : null;

  // 定位这次申请对应的学生档案与班级
  let student;
  let cls;
  if (kind === 'leave') {
    if (!wantLesson) throw new ApiError(404, '课时不存在');
    student = mine.find((s) => s.class_id === wantLesson.class_id);
    if (!student) throw new ApiError(403, '你不在该课时所属班级中，无法请假');
    cls = { id: wantLesson.class_id, name: '', teacher_id: wantLesson.teacher_id };
  } else {
    cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(Number(b.class_id));
    if (!cls) throw new ApiError(404, '班级不存在');
    student = mine.find((s) => s.class_id === cls.id);
    if (!student) throw new ApiError(403, '你不在该班级中');
  }

  if (kind === 'leave') {
    if (wantLesson.status === 'canceled') throw new ApiError(400, '本节课已取消，无需请假');
    const dup = db.prepare(
      "SELECT id FROM requests WHERE kind = 'leave' AND lesson_id = ? AND student_id = ? AND status = 'pending'"
    ).get(wantLesson.id, student.id);
    if (dup) throw new ApiError(400, '你已经提交过请假申请，等待老师处理');
  } else {
    if (!isDate(b.date)) throw new ApiError(400, '请选择上课日期');
    if (!isTime(b.start_time)) throw new ApiError(400, '请选择上课时间');
    if (b.date < today()) throw new ApiError(400, '不能预约过去的日期');
    const dup = db.prepare(
      "SELECT id FROM requests WHERE kind = 'booking' AND student_id = ? AND date = ? AND status = 'pending'"
    ).get(student.id, b.date);
    if (dup) throw new ApiError(400, '这一天你已经提交过预约申请');
  }

  const duration = Math.min(Math.max(Number(b.duration_min) || 90, 15), 480);
  // 预约时段先查一次冲突，把结果告诉学生（老师审批时还会再查一次）
  let conflictNote = '';
  if (kind === 'booking') {
    const conflicts = findConflicts(cls.teacher_id, {
      class_id: cls.id, date: b.date, start_time: b.start_time, duration_min: duration, room: String(b.room || ''),
    });
    if (conflicts.length) conflictNote = conflictText(conflicts[0]);
  }

  const r = db.prepare(`
    INSERT INTO requests (kind, class_id, lesson_id, student_id, teacher_id, date, start_time, duration_min, room, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    kind, cls.id, kind === 'leave' ? wantLesson.id : null, student.id, cls.teacher_id,
    kind === 'leave' ? wantLesson.date : b.date,
    kind === 'leave' ? wantLesson.start_time : b.start_time,
    kind === 'leave' ? wantLesson.duration_min : duration,
    String(b.room || ''),
    String(b.reason || '').slice(0, 500)
  );

  res.status(201).json({ request: requestRow(r.lastInsertRowid), conflict_note: conflictNote });

  // 提交后提醒老师（放在响应之后发，失败也不影响提交）
  notify(
    cls.teacher_id,
    kind === 'leave' ? '新请假申请' : '新预约申请',
    `${student.name}：${kind === 'leave' ? `申请 ${wantLesson.date} ${wantLesson.start_time} 请假` : `预约 ${b.date} ${b.start_time}${conflictNote ? `（注意：${conflictNote}）` : ''}`}`,
    '/requests'
  );
}));

/** 学生撤销自己待处理的申请 */
router.delete('/:id', h(async (req, res) => {
  const row = requestRow(Number(req.params.id));
  if (!row) throw new ApiError(404, '申请不存在');
  const mine = db.prepare('SELECT id FROM students WHERE id = ? AND user_id = ?').get(row.student_id, req.user.id);
  if (!mine && !roleAtLeast(req.user, 'admin')) throw new ApiError(403, '只能撤销自己的申请');
  if (row.status !== PENDING) throw new ApiError(400, '该申请已被处理，无法撤销');
  db.prepare("UPDATE requests SET status = 'canceled', decided_at = ? WHERE id = ?").run(nowStamp(), row.id);
  res.json({ request: requestRow(row.id) });
}));

/** 审批：通过 */
router.put('/:id/approve', h(async (req, res) => {
  const row = requestRow(Number(req.params.id));
  if (!row) throw new ApiError(404, '申请不存在');
  const isOwnerTeacher = req.user.role === 'teacher' && row.teacher_id === req.user.id;
  if (!isOwnerTeacher && !roleAtLeast(req.user, 'admin')) throw new ApiError(403, '无权处理该申请');
  if (row.status !== PENDING) throw new ApiError(400, '该申请已处理过');

  const note = String(req.body?.note || '').slice(0, 200);
  let createdLessonId = null;

  db.exec('BEGIN');
  try {
    if (row.kind === 'leave') {
      // 通过请假 -> 该节课直接记为「请假」
      const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(row.lesson_id);
      if (lesson) {
        const existing = db.prepare(
          'SELECT id FROM attendance WHERE lesson_id = ? AND student_id = ?'
        ).get(lesson.id, row.student_id);
        if (existing) {
          db.prepare("UPDATE attendance SET status = 'leave', checked_at = datetime('now','localtime') WHERE id = ?")
            .run(existing.id);
        } else {
          db.prepare("INSERT INTO attendance (lesson_id, student_id, status) VALUES (?, ?, 'leave')")
            .run(lesson.id, row.student_id);
        }
      }
    } else {
      // 通过预约 -> 建课；若此时已被其他课占用同一时段，则拒绝并说明
      const conflicts = findConflicts(row.teacher_id, {
        class_id: row.class_id,
        date: row.date,
        start_time: row.start_time,
        duration_min: row.duration_min,
        room: row.room,
      });
      if (conflicts.length) throw new ApiError(409, `该时段已与「${conflictText(conflicts[0])}」冲突，请改期或驳回`);

      const r = db.prepare(
        'INSERT INTO lessons (class_id, date, start_time, duration_min, room, topic) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(row.class_id, row.date, row.start_time, row.duration_min, row.room, `【预约】${row.student_name}`);
      createdLessonId = r.lastInsertRowid;
    }

    db.prepare(`
      UPDATE requests SET status = 'approved', decided_note = ?, decided_by = ?, decided_at = ?, created_lesson_id = ?
      WHERE id = ?
    `).run(note, req.user.id, nowStamp(), createdLessonId, row.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  res.json({ request: requestRow(row.id), lesson_id: createdLessonId });

  // 审批结果通知学生（有绑定账号才发）
  const stu = db.prepare('SELECT user_id, name FROM students WHERE id = ?').get(row.student_id);
  if (stu?.user_id) {
    notify(
      stu.user_id,
      row.kind === 'leave' ? '请假申请已通过' : '预约已通过',
      row.kind === 'leave'
        ? `你 ${row.date} ${row.start_time} 的请假已通过${note ? `：${note}` : ''}`
        : `你预约的 ${row.date} ${row.start_time} 已排课${note ? `：${note}` : ''}`,
      '/schedule'
    );
  }
}));

/** 审批：驳回 */
router.put('/:id/reject', h(async (req, res) => {
  const row = requestRow(Number(req.params.id));
  if (!row) throw new ApiError(404, '申请不存在');
  const isOwnerTeacher = req.user.role === 'teacher' && row.teacher_id === req.user.id;
  if (!isOwnerTeacher && !roleAtLeast(req.user, 'admin')) throw new ApiError(403, '无权处理该申请');
  if (row.status !== PENDING) throw new ApiError(400, '该申请已处理过');

  db.prepare(`
    UPDATE requests SET status = 'rejected', decided_note = ?, decided_by = ?, decided_at = ? WHERE id = ?
  `).run(String(req.body?.note || '').slice(0, 200), req.user.id, nowStamp(), row.id);
  res.json({ request: requestRow(row.id) });

  const stu = db.prepare('SELECT user_id FROM students WHERE id = ?').get(row.student_id);
  if (stu?.user_id) {
    notify(
      stu.user_id,
      row.kind === 'leave' ? '请假申请被驳回' : '预约被驳回',
      `你 ${row.date} ${row.start_time} 的申请未通过${req.body?.note ? `：${req.body.note}` : ''}`,
      '/requests'
    );
  }
}));

/** 我提交过的申请汇总（学生自己的请假/缺勤情况） */
router.get('/my-summary', h(async (req, res) => {
  const rows = db.prepare(`
    SELECT r.kind, r.status, COUNT(*) AS n FROM requests r
    JOIN students s ON s.id = r.student_id WHERE s.user_id = ? GROUP BY r.kind, r.status
  `).all(req.user.id);
  const summary = { leave_pending: 0, leave_approved: 0, booking_pending: 0, booking_approved: 0 };
  for (const r of rows) {
    const key = `${r.kind}_${r.status}`;
    if (key in summary) summary[key] = r.n;
  }
  res.json({ summary });
}));

export default router;
