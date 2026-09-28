import { Router } from 'express';
import { db, today } from '../db.js';
import { authRequired, teacherOnly, assertClassAccess, roleAtLeast } from '../middleware.js';
import { h, ApiError, isDate, addDays, genFeedToken, toMin, minToTime } from '../util.js';
import { findConflicts, conflictText } from '../conflicts.js';
import { buildIcs, parseIcs } from '../ics.js';

const router = Router();

/** 一个用户能看到的全部课时（订阅与导出共用） */
function lessonsFor(user, { from, to, classId = null } = {}) {
  const conds = ['l.date BETWEEN ? AND ?'];
  const params = [from, to];
  if (classId) {
    conds.push('l.class_id = ?');
    params.push(classId);
  } else if (roleAtLeast(user, 'admin')) {
    // 管理员导出全部
  } else if (user.role === 'teacher') {
    conds.push('c.teacher_id = ?');
    params.push(user.id);
  } else {
    conds.push('l.class_id IN (SELECT class_id FROM students WHERE user_id = ?)');
    params.push(user.id);
  }
  return db.prepare(`
    SELECT l.*, c.name AS class_name, c.teacher_id,
           (SELECT content FROM lesson_records r WHERE r.lesson_id = l.id) AS record
    FROM lessons l JOIN classes c ON c.id = l.class_id
    WHERE ${conds.join(' AND ')}
    ORDER BY l.date, l.start_time
  `).all(...params);
}

function toEvents(lessons, { includeRecord = false } = {}) {
  return lessons.map((l) => ({
    uid: `lesson-${l.id}@eduhub`,
    date: l.date,
    start_time: l.start_time,
    duration_min: l.duration_min,
    summary: `${l.class_name}${l.topic ? `｜${l.topic}` : ''}`,
    location: l.room,
    description: [
      l.topic ? `主题：${l.topic}` : '',
      l.room ? `教室：${l.room}` : '',
      `时长：${l.duration_min} 分钟`,
      includeRecord && l.record ? `课堂记录：${l.record}` : '',
    ].filter(Boolean).join('\n'),
    status: l.status,
  }));
}

/**
 * 日历订阅源：手机自带日历可以直接「订阅」这个地址，之后课表变化会自动同步。
 * 日历客户端无法携带请求头，所以用 URL 里的令牌鉴权（可在「我的」里重置）。
 */
router.get('/feed.ics', h(async (req, res) => {
  const token = String(req.query.token || '');
  if (!token) throw new ApiError(401, '缺少订阅令牌');
  const user = db.prepare('SELECT id, name, role FROM users WHERE feed_token = ?').get(token);
  if (!user) throw new ApiError(401, '订阅令牌无效或已重置');

  const from = addDays(today(), -30);
  const to = addDays(today(), 180);
  const lessons = lessonsFor(user, { from, to }).filter((l) => l.status !== 'canceled');
  const ics = buildIcs(toEvents(lessons), { calendarName: `师枢课表 - ${user.name}` });
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="eduhub.ics"');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(ics);
}));

/** 获取（必要时生成）我的日历订阅地址 */
router.get('/feed-url', authRequired, h(async (req, res) => {
  let row = db.prepare('SELECT feed_token FROM users WHERE id = ?').get(req.user.id);
  if (!row?.feed_token) {
    const token = genFeedToken();
    db.prepare('UPDATE users SET feed_token = ? WHERE id = ?').run(token, req.user.id);
    row = { feed_token: token };
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const httpsUrl = `${proto}://${host}/api/calendar/feed.ics?token=${row.feed_token}`;
  res.json({
    token: row.feed_token,
    url: httpsUrl,
    // 手机日历更认 webcal:// 前缀，直接点就能唤起订阅
    webcal: httpsUrl.replace(/^https?:\/\//, 'webcal://'),
  });
}));

/** 重置订阅令牌（旧链接立即失效） */
router.post('/feed-token/reset', authRequired, h(async (req, res) => {
  const token = genFeedToken();
  db.prepare('UPDATE users SET feed_token = ? WHERE id = ?').run(token, req.user.id);
  res.json({ token });
}));

/** 一次性导出 .ics 文件（可用手机日历打开） */
router.get('/export.ics', authRequired, h(async (req, res) => {
  const classId = req.query.class_id ? Number(req.query.class_id) : null;
  if (classId) assertClassAccess(req.user, classId);
  const from = isDate(req.query.from) ? req.query.from : addDays(today(), -90);
  const to = isDate(req.query.to) ? req.query.to : addDays(today(), 180);

  const lessons = lessonsFor(req.user, { from, to, classId });
  if (!lessons.length) throw new ApiError(404, '这段时间没有可导出的课时');

  const name = classId ? lessons[0].class_name : `${req.user.name}的课表`;
  const ics = buildIcs(toEvents(lessons, { includeRecord: true }), { calendarName: `师枢课表 - ${name}` });
  const filename = encodeURIComponent(`${name}-${from}_${to}.ics`);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="eduhub.ics"; filename*=UTF-8''${filename}`);
  res.send(ics);
}));

/**
 * 从 .ics 导入课时（教师）：手机上导出的日历文件可以直接贴进来，
 * dry_run 先预览（标出冲突），确认后再落库。
 */
router.post('/import.ics', authRequired, teacherOnly, h(async (req, res) => {
  const b = req.body || {};
  const cls = assertClassAccess(req.user, Number(b.class_id));
  const text = String(b.text || '');
  if (!text.includes('BEGIN:VCALENDAR') || !text.includes('BEGIN:VEVENT')) {
    throw new ApiError(400, '这不是有效的 .ics 日历文件');
  }

  const parsed = parseIcs(text);
  if (!parsed.length) throw new ApiError(400, '文件里没有找到任何日程');
  if (parsed.length > 200) throw new ApiError(400, `一次最多导入 200 条，当前 ${parsed.length} 条`);

  const plan = parsed.map((e) => {
    const row = {
      date: e.date,
      start_time: e.start_time,
      duration_min: e.duration_min,
      room: e.room || String(b.room || ''),
      topic: String(e.topic || '').slice(0, 120),
      canceled: e.canceled,
    };
    if (e.date < '2000-01-01' || e.date > '2099-12-31') return { ...row, status: 'invalid', reason: '日期超出范围' };
    if (e.canceled) return { ...row, status: 'skip', reason: '日程已取消' };
    const conflicts = findConflicts(req.user.id, {
      class_id: cls.id, date: e.date, start_time: e.start_time, duration_min: e.duration_min, room: row.room,
    });
    if (conflicts.length) return { ...row, status: 'conflict', reason: conflictText(conflicts[0]) };
    return { ...row, status: 'ok', reason: '' };
  });

  const summary = {
    total: plan.length,
    ok: plan.filter((p) => p.status === 'ok').length,
    conflict: plan.filter((p) => p.status === 'conflict').length,
    skip: plan.filter((p) => p.status !== 'ok' && p.status !== 'conflict').length,
    conflict_skip: b.skip_conflicts !== false,
  };

  if (b.dry_run !== false) return res.json({ plan, summary, class: { id: cls.id, name: cls.name } });

  const skipConflicts = b.skip_conflicts !== false;
  const insert = db.prepare(
    'INSERT INTO lessons (class_id, date, start_time, duration_min, room, topic) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const createdIds = [];
  db.exec('BEGIN');
  try {
    for (const p of plan) {
      if (p.status !== 'ok' && !(p.status === 'conflict' && !skipConflicts)) continue;
      createdIds.push(insert.run(cls.id, p.date, p.start_time, p.duration_min, p.room, p.topic).lastInsertRowid);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  const created = createdIds.map((id) => db.prepare(`
    SELECT l.*, c.name AS class_name, c.color AS class_color FROM lessons l
    JOIN classes c ON c.id = l.class_id WHERE l.id = ?
  `).get(id));
  res.status(201).json({ created, skipped: plan.filter((p) => p.status !== 'ok'), summary });
}));

export default router;
