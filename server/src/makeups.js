import { db } from './db.js';

/**
 * 待补课台账。
 *
 * 规则：学生请假的已完成课时会挂一条「欠课」，补上了（done）或老师决定不补（waived）才销账。
 * 出勤状态从「请假」改回出勤/迟到时，欠课自动撤掉——否则老师改一次签到就多一笔烂账。
 * 唯一索引保证同一节课同一学生只会有一条待补记录，重复保存签到不会重复记账。
 */

/** 记一笔欠课（幂等） */
export function markOwed(studentId, classId, lesson, reason = 'leave') {
  if (!studentId || !lesson?.id) return;
  try {
    db.prepare(`
      INSERT INTO makeups (student_id, class_id, missed_lesson_id, missed_date, reason, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
      ON CONFLICT(student_id, missed_lesson_id) DO UPDATE SET
        reason = excluded.reason,
        updated_at = datetime('now','localtime')
      WHERE makeups.status = 'pending'
    `).run(studentId, classId, lesson.id, lesson.date, reason);
  } catch (e) {
    // 补课台账不该挡住签到，但也不能一声不吭——记账失败必须看得见
    console.warn(`[补课台账] 记录失败（student=${studentId} lesson=${lesson.id}）：${e?.message || e}`);
  }
}

/** 该学生这节课不再欠了（改成出勤/迟到，或整节删除） */
export function clearOwed(studentId, lessonId) {
  if (!studentId || !lessonId) return;
  try {
    db.prepare("DELETE FROM makeups WHERE student_id = ? AND missed_lesson_id = ? AND status = 'pending'")
      .run(studentId, lessonId);
  } catch (e) {
    console.warn(`[补课台账] 撤销失败（student=${studentId} lesson=${lessonId}）：${e?.message || e}`);
  }
}

const MAKEUP_COLS = `
  m.id, m.student_id, m.class_id, m.missed_lesson_id, m.missed_date, m.reason,
  m.status, m.makeup_lesson_id, m.note, m.created_at, m.updated_at,
  s.name AS student_name,
  ml.start_time AS missed_start_time, ml.duration_min AS missed_duration,
  mk.date AS makeup_date, mk.start_time AS makeup_start_time
`;

/** 某班的补课台账 */
export function listMakeups(classId, { status = null, limit = 100 } = {}) {
  const conds = ['m.class_id = ?'];
  const params = [classId];
  if (status) {
    conds.push('m.status = ?');
    params.push(status);
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 300));
  return db.prepare(`
    SELECT ${MAKEUP_COLS}
    FROM makeups m
    JOIN students s ON s.id = m.student_id
    LEFT JOIN lessons ml ON ml.id = m.missed_lesson_id
    LEFT JOIN lessons mk ON mk.id = m.makeup_lesson_id
    WHERE ${conds.join(' AND ')}
    ORDER BY CASE m.status WHEN 'pending' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
             m.missed_date DESC, m.id DESC
    LIMIT ?
  `).all(...params);
}

/** 某班每个学生欠了几节 */
export function owedByStudent(classId) {
  const rows = db.prepare(`
    SELECT student_id, COUNT(*) AS n FROM makeups
    WHERE class_id = ? AND status IN ('pending', 'scheduled')
    GROUP BY student_id
  `).all(classId);
  return new Map(rows.map((r) => [r.student_id, r.n]));
}

export function getMakeup(id) {
  return db.prepare(`
    SELECT ${MAKEUP_COLS}
    FROM makeups m
    JOIN students s ON s.id = m.student_id
    LEFT JOIN lessons ml ON ml.id = m.missed_lesson_id
    LEFT JOIN lessons mk ON mk.id = m.makeup_lesson_id
    WHERE m.id = ?
  `).get(Number(id)) || null;
}

export function updateMakeup(id, { status, makeup_lesson_id, note }) {
  const cur = getMakeup(id);
  if (!cur) return null;
  const nextStatus = status === undefined ? cur.status : String(status);
  if (!['pending', 'scheduled', 'done', 'waived'].includes(nextStatus)) return { error: '状态不合法' };
  const nextLesson = makeup_lesson_id === undefined ? cur.makeup_lesson_id : (makeup_lesson_id ? Number(makeup_lesson_id) : null);
  const nextNote = note === undefined ? cur.note : String(note).slice(0, 120);
  db.prepare(`
    UPDATE makeups SET status = ?, makeup_lesson_id = ?, note = ?, updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(nextStatus, nextLesson, nextNote, cur.id);
  return { makeup: getMakeup(cur.id) };
}
