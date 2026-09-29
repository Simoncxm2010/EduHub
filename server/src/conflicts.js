import { db } from './db.js';
import { toMin, minToTime } from './util.js';

/**
 * 找出该教师当天的排课冲突：
 * - type=class  ：同一班级时间重叠（同一个班不可能同时上两节课）
 * - type=room   ：不同班级但同一教室时间重叠
 * - type=teacher：同一位老师的两节不同班的课时间重叠（人不能同时上两节课）
 * - type=gap    ：与该教师另一节课之间的间隔小于他设置的「最短间隔」
 *                 （跨班、跨教室都算——老师得有时间赶过去）
 *
 * @param opts.exclude_id 调课时排除自己那一节；可传数组（对调要同时排除两节）
 */
export function findConflicts(teacherId, { class_id, date, start_time, duration_min = 60, room = '', exclude_id = null }) {
  const start = toMin(start_time);
  const end = start + Number(duration_min || 60);
  const gap = minGapOf(teacherId);
  const exclude = new Set([].concat(exclude_id ?? []).map(Number).filter(Boolean));

  const rows = db.prepare(`
    SELECT l.id, l.class_id, l.date, l.start_time, l.duration_min, l.room, l.topic, c.name AS class_name
    FROM lessons l JOIN classes c ON c.id = l.class_id
    WHERE c.teacher_id = ? AND l.date = ? AND l.status != 'canceled'
  `).all(teacherId, date);

  const out = [];
  const seen = new Set();
  for (const r of rows) {
    if (exclude.has(Number(r.id))) continue;
    const s = toMin(r.start_time);
    const e = s + Number(r.duration_min || 60);

    const overlap = s < end && start < e;
    if (overlap) {
      if (class_id && r.class_id === Number(class_id)) push(out, seen, { type: 'class', lesson: r, gap: 0 });
      else if (room && r.room && r.room === room) push(out, seen, { type: 'room', lesson: r, gap: 0 });
      // 既不是同班也不是同教室，但仍是这位老师的两节课——人不可能同时上两节课
      else push(out, seen, { type: 'teacher', lesson: r, gap: 0 });
      continue; // 已经算重叠冲突，不再重复报间隔不足
    }

    // 不重叠但挨得太近：这时候教室其实是空的，问题只在间隔，所以一律报 gap
    if (gap > 0) {
      const distance = s >= end ? s - end : start - e;
      if (distance < gap) {
        push(out, seen, { type: 'gap', lesson: r, gap, distance });
      }
    }
  }
  return out;
}

function push(out, seen, item) {
  const key = `${item.type}:${item.lesson.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(item);
}

/** 老师设置的「两节课之间最短间隔」（分钟），未设置时为 0 */
export function minGapOf(userId) {
  const row = db.prepare('SELECT min_gap_min FROM users WHERE id = ?').get(userId);
  return Math.max(0, Number(row?.min_gap_min) || 0);
}

export function conflictText(c) {
  const l = c.lesson;
  const span = `${l.start_time}-${minToTime(toMin(l.start_time) + l.duration_min)}`;
  if (c.type === 'room') return `${l.class_name} ${span}（教室 ${l.room} 占用）`;
  if (c.type === 'teacher') return `${l.class_name} ${span}（你的另一节课，时间重叠）`;
  if (c.type === 'gap') return `${l.class_name} ${span}（间隔仅 ${c.distance} 分钟，少于你设置的 ${c.gap} 分钟）`;
  return `${l.class_name} ${span}`;
}
