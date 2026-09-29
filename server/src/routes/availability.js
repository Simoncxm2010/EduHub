import { Router } from 'express';
import { db, today } from '../db.js';
import { authRequired, teacherOnly, assertClassAccess, roleAtLeast } from '../middleware.js';
import { h, ApiError, isTime, toMin, eachDate, weekdayOf, minToTime } from '../util.js';
import { recognizeAvailability, llmConfig, normalizeWindows } from '../llm.js';

const router = Router();
router.use(authRequired);

const MAX_WINDOWS = 40;
const SLOT_STEP = 30; // 匹配粒度：半小时

const WINDOW_COLS = 'id, weekday, start_time, end_time, note, source';

function listWindows(userId) {
  return db.prepare(
    `SELECT ${WINDOW_COLS} FROM availability WHERE user_id = ? ORDER BY weekday, start_time`
  ).all(userId);
}

function listStudentWindows(studentId) {
  return db.prepare(
    `SELECT ${WINDOW_COLS} FROM availability WHERE student_id = ? ORDER BY weekday, start_time`
  ).all(studentId);
}

/**
 * 某个学生记录的有效时段。
 * - 没有账号的学生：只能由老师代填，挂在 student_id 上
 * - 有账号的学生：优先用他自己填的；他还没填过时，沿用注册前老师代填的那份
 */
function windowsOfStudent(student) {
  if (!student.user_id) return listStudentWindows(student.id);
  const own = listWindows(student.user_id);
  return own.length ? own : listStudentWindows(student.id);
}

/** 校验并规范化请求里的时段数组 */
function cleanWindows(items) {
  if (!Array.isArray(items)) throw new ApiError(400, 'windows 必须是数组');
  if (items.length > MAX_WINDOWS) throw new ApiError(400, `最多设置 ${MAX_WINDOWS} 个时段`);
  const cleaned = [];
  for (const it of items) {
    const weekday = Number(it?.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new ApiError(400, '星期不正确');
    if (!isTime(it?.start_time) || !isTime(it?.end_time)) throw new ApiError(400, '时间格式不正确');
    if (toMin(it.start_time) >= toMin(it.end_time)) throw new ApiError(400, '开始时间必须早于结束时间');
    cleaned.push({ weekday, start_time: it.start_time, end_time: it.end_time, note: String(it.note || '').slice(0, 60) });
  }
  return cleaned;
}

/** 覆盖式写入某一组时段（要么挂 user_id，要么挂 student_id） */
function replaceWindows({ userId = null, studentId = null, source, cleaned }) {
  db.exec('BEGIN');
  try {
    if (userId) db.prepare('DELETE FROM availability WHERE user_id = ?').run(userId);
    if (studentId) db.prepare('DELETE FROM availability WHERE student_id = ?').run(studentId);
    const ins = db.prepare(
      'INSERT INTO availability (user_id, student_id, weekday, start_time, end_time, note, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const c of cleaned) ins.run(userId, studentId, c.weekday, c.start_time, c.end_time, c.note, source);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** 学生必须属于当前老师（或管理员）能管的班级 */
function assertStudentAccess(user, studentId) {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(Number(studentId));
  if (!student) throw new ApiError(404, '学生不存在');
  assertClassAccess(user, student.class_id);
  return student;
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
  const cleaned = cleanWindows(req.body?.windows);
  replaceWindows({ userId: req.user.id, source: 'self', cleaned });
  res.json({ windows: listWindows(req.user.id) });
}));

/* ---------------- 老师代学生填写时段 ---------------- */

/** 某班学生的时段概览（教师在协调时间时参考） */
router.get('/class/:id', teacherOnly, h(async (req, res) => {
  const cls = assertClassAccess(req.user, Number(req.params.id));
  const students = db.prepare(
    'SELECT id, name, user_id FROM students WHERE class_id = ? ORDER BY created_at, id'
  ).all(cls.id);
  const out = students.map((s) => {
    const windows = windowsOfStudent(s);
    return {
      student_id: s.id,
      name: s.name,
      has_account: !!s.user_id,
      // 学生自己填过没有：全是他填的就是 self，老师代填的是 teacher
      filled_by_self: windows.some((w) => w.source === 'self'),
      windows,
    };
  });
  res.json({ students: out });
}));

/** 单个学生的时段（老师打开编辑器时读） */
router.get('/student/:studentId', teacherOnly, h(async (req, res) => {
  const student = assertStudentAccess(req.user, req.params.studentId);
  res.json({
    student: { id: student.id, name: student.name, class_id: student.class_id, has_account: !!student.user_id },
    windows: windowsOfStudent(student),
  });
}));

/**
 * 老师替学生保存时段（覆盖式）。
 * 学生有账号时写进他自己的时段表，他登录后就能看到并自行调整；
 * 没有账号（手动登记的学生）就挂在 student_id 上 —— 这类学生以前根本填不了时段。
 */
router.put('/student/:studentId', teacherOnly, h(async (req, res) => {
  const student = assertStudentAccess(req.user, req.params.studentId);
  const cleaned = cleanWindows(req.body?.windows);
  if (student.user_id) replaceWindows({ userId: student.user_id, studentId: student.id, source: 'teacher', cleaned });
  else replaceWindows({ studentId: student.id, source: 'teacher', cleaned });
  res.json({
    student: { id: student.id, name: student.name, has_account: !!student.user_id },
    windows: windowsOfStudent(student),
  });
}));

/**
 * 大模型识别接口（预留）：把自然语言描述或聊天截图转成时段建议。
 * 老师与学生都能用：老师用来代填/核对，学生用来把自己的口语描述变成时段。
 * 只返回建议、不落库，确认后再调 PUT / 或 PUT /student/:id 保存。
 */
router.post('/recognize', h(async (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 2000);
  const rawImage = typeof req.body?.image === 'string' ? req.body.image : '';
  if (!text && !rawImage) throw new ApiError(400, '请提供文字描述或图片');
  if (rawImage && !/^data:image\/(png|jpe?g|webp);base64,/.test(rawImage)) {
    throw new ApiError(400, '图片格式不支持，请使用 PNG / JPG / WebP');
  }

  const result = await recognizeAvailability({ text, image: rawImage });
  const { configured, model, vision } = llmConfig();
  res.json({
    // 再兜一层校验：任何通道的结果都必须合法
    windows: normalizeWindows(result.windows),
    provider: result.provider,
    warnings: result.warnings,
    raw: result.raw,
    llm: { configured, model: configured ? model : null, vision },
  });
}));

/* ---------------- 智能协调时间 ---------------- */

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
  const studentWindows = new Map(students.map((s) => [s.id, windowsOfStudent(s)]));

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
