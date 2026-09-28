// 演示数据：教师/管理员/超管/学生四种账号 + 班级 + 排期 + 可上课时段
// 运行: npm run seed
import bcrypt from 'bcryptjs';
import { db, today } from './db.js';
import { addDays } from './util.js';

const hash = (p) => bcrypt.hashSync(p, 10);

/** 已存在则更新角色与密码，不存在则创建 */
function ensureUser(name, phone, role, password) {
  const existing = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (existing) {
    db.prepare('UPDATE users SET name = ?, role = ?, status = ?, password_hash = ? WHERE id = ?')
      .run(name, role, 'active', hash(password), existing.id);
    return { id: existing.id, created: false };
  }
  const r = db.prepare('INSERT INTO users (name, phone, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, phone, hash(password), role);
  return { id: r.lastInsertRowid, created: true };
}

const teacher = ensureUser('演示王老师', '13800000001', 'teacher', 'demo123456');
ensureUser('张校长', '13800000000', 'super', 'demo123456');
ensureUser('李教务', '13800000002', 'admin', 'demo123456');
const demoStudent = ensureUser('演示学生小陈', '13900000001', 'student', 'demo123456');

let cls = db.prepare('SELECT * FROM classes WHERE name = ?').get('初二物理培优班');
if (!cls) {
  const r = db.prepare(
    'INSERT INTO classes (teacher_id, name, subject, description, color, invite_code, rate) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(teacher.id, '初二物理培优班', '物理', '力学与电学专题提升', '#00B8A9', 'DEMO66', 200);
  cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(r.lastInsertRowid);
}

// 演示学生绑定到该班
const stuRow = db.prepare('SELECT id FROM students WHERE class_id = ? AND user_id = ?').get(cls.id, demoStudent.id);
if (!stuRow) {
  db.prepare('INSERT INTO students (class_id, user_id, name, phone) VALUES (?, ?, ?, ?)')
    .run(cls.id, demoStudent.id, '演示学生小陈', '13900000001');
}

const addStudent = db.prepare('INSERT INTO students (class_id, name, phone) VALUES (?, ?, ?)');
const studentCount = db.prepare('SELECT COUNT(*) AS n FROM students WHERE class_id = ?').get(cls.id).n;
const studentIds = db.prepare('SELECT id FROM students WHERE class_id = ? ORDER BY id').all(cls.id).map((s) => s.id);
if (studentCount === 1) {
  for (const name of ['陈小明', '林小雨', '赵子轩', '王一诺']) {
    studentIds.push(addStudent.run(cls.id, name, '').lastInsertRowid);
  }
}

// 只有从来没有排过课时才造排期，避免重复运行堆数据
const lessonCount = db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE class_id = ?').get(cls.id).n;
if (lessonCount === 0) {
  const addLesson = db.prepare(
    'INSERT INTO lessons (class_id, date, start_time, duration_min, room, topic, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  // 昨天：已完成的课（含签到、签名与课堂记录）
  const past = addLesson.run(cls.id, addDays(today(), -1), '18:30', 90, '301教室', '牛顿第二定律应用', 'done').lastInsertRowid;
  const mark = db.prepare('INSERT INTO attendance (lesson_id, student_id, status) VALUES (?, ?, ?)');
  const statuses = ['present', 'late', 'present', 'absent'];
  studentIds.slice(0, 4).forEach((sid, i) => mark.run(past, sid, statuses[i] || 'present'));
  db.prepare('INSERT INTO lesson_records (lesson_id, content, homework) VALUES (?, ?, ?)')
    .run(past, '讲解牛顿第二定律典型题型，完成例题 6 道。', '练习册 P45-46 第 1-8 题');

  // 今天起每周一次，共 4 次
  for (let i = 0; i < 4; i++) {
    addLesson.run(cls.id, addDays(today(), i * 7), '18:30', 90, '301教室', i === 0 ? '功与功率' : '', 'scheduled');
  }
}

// 演示「智能协调时间」：老师与学生都填上时段
const setWindows = (userId, weekdayList) => {
  db.prepare('DELETE FROM availability WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT INTO availability (user_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)');
  for (const d of weekdayList) ins.run(userId, d, '18:00', '21:00');
};
setWindows(teacher.id, [1, 2, 3, 4, 5, 6, 0]);
setWindows(demoStudent.id, [1, 3, 5]);

console.log('演示数据创建完成：');
console.log('  超级管理员  13800000000 / demo123456  张校长');
console.log('  管理员      13800000002 / demo123456  李教务');
console.log('  教师        13800000001 / demo123456  演示王老师');
console.log('  学生        13900000001 / demo123456  演示学生小陈');
console.log(`  班级邀请码  ${cls.invite_code}（学生注册后凭此加入「${cls.name}」）`);
