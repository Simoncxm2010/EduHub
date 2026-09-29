import { db } from './db.js';

/**
 * 补课班的「课时包」账目。
 *
 * 口径（老师最容易理解、也最常被家长问的那种）：
 * - 已消课时 = 已完成课时里，该学生状态为 出勤 / 迟到 / 缺勤 的节数
 * - 请假**不扣**（那节课要补回来，销账在 makeups 里）
 * - 缺勤**要扣**（没提前请假，位子占了）
 * - 剩余 = 购买节数 + 赠送节数 − 已消课时
 *
 * 之所以不把「请假」算进消耗，是因为补课班普遍允许补课；
 * 补上了才真正消耗课时，具体记在 makeups 表。
 */

/** 真正上掉的节数 */
export function usedLessons(studentId) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM attendance a
    JOIN lessons l ON l.id = a.lesson_id
    WHERE a.student_id = ? AND l.status = 'done' AND a.status IN ('present', 'late', 'absent')
  `).get(studentId).n;
}

/** 单个学生的课时账 */
export function creditsOf(student) {
  const used = usedLessons(student.id);
  const total = Number(student.lessons_total) || 0;
  const bonus = Number(student.lessons_bonus) || 0;
  const remaining = total + bonus - used;
  return {
    lessons_total: total,
    lessons_bonus: bonus,
    used,
    remaining,
    // 没买课时包（total=0）就谈不上「余额不足」，不打扰老师
    low: total > 0 && remaining <= 2,
    owed: total > 0 && remaining <= 0,
  };
}

/**
 * 整班的课时账，一次查完避免 N+1。
 * @returns Map<student_id, {used, remaining, low, owed, ...}>
 */
export function creditsOfClass(classId) {
  const rows = db.prepare(`
    SELECT a.student_id, COUNT(*) AS n FROM attendance a
    JOIN lessons l ON l.id = a.lesson_id
    WHERE l.class_id = ? AND l.status = 'done' AND a.status IN ('present', 'late', 'absent')
    GROUP BY a.student_id
  `).all(classId);
  const usedMap = new Map(rows.map((r) => [r.student_id, r.n]));

  const students = db.prepare(
    'SELECT id, lessons_total, lessons_bonus FROM students WHERE class_id = ?'
  ).all(classId);

  const out = new Map();
  for (const s of students) {
    const used = usedMap.get(s.id) || 0;
    const total = Number(s.lessons_total) || 0;
    const bonus = Number(s.lessons_bonus) || 0;
    const remaining = total + bonus - used;
    out.set(s.id, {
      lessons_total: total,
      lessons_bonus: bonus,
      used,
      remaining,
      low: total > 0 && remaining <= 2,
      owed: total > 0 && remaining <= 0,
    });
  }
  return out;
}
