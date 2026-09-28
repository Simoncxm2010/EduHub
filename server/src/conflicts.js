import { db } from './db.js';
import { toMin, minToTime } from './util.js';

/**
 * 找出该教师当天的排课冲突：
 * - type=class：同一班级时间重叠（同一个班不可能同时上两节课）
 * - type=room ：不同班级但同一教室时间重叠
 */
export function findConflicts(teacherId, { class_id, date, start_time, duration_min = 60, room = '' }) {
  const start = toMin(start_time);
  const end = start + Number(duration_min || 60);
  const rows = db.prepare(`
    SELECT l.id, l.class_id, l.date, l.start_time, l.duration_min, l.room, l.topic, c.name AS class_name
    FROM lessons l JOIN classes c ON c.id = l.class_id
    WHERE c.teacher_id = ? AND l.date = ? AND l.status != 'canceled'
  `).all(teacherId, date);

  const out = [];
  for (const r of rows) {
    const s = toMin(r.start_time);
    const e = s + Number(r.duration_min || 60);
    if (s >= end || start >= e) continue; // 不重叠
    if (class_id && r.class_id === Number(class_id)) out.push({ type: 'class', lesson: r });
    else if (room && r.room && r.room === room) out.push({ type: 'room', lesson: r });
  }
  return out;
}

export function conflictText(c) {
  const l = c.lesson;
  return c.type === 'room'
    ? `${l.class_name} ${l.start_time}（教室 ${l.room} 占用）`
    : `${l.class_name} ${l.start_time}-${minToTime(toMin(l.start_time) + l.duration_min)}`;
}
