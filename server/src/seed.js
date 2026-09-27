// 演示数据：创建一个教师账号、班级、学生与排期，便于快速体验
// 运行: npm run seed
import bcrypt from 'bcryptjs';
import { db, today } from './db.js';
import { addDays } from './util.js';

const phone = '13800000001';
const exists = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
if (exists) {
  console.log('演示账号已存在，无需重复创建。');
  console.log(`  教师登录: ${phone} / demo123456`);
  process.exit(0);
}

const hash = bcrypt.hashSync('demo123456', 10);
const teacher = db.prepare('INSERT INTO users (name, phone, password_hash, role) VALUES (?, ?, ?, ?)')
  .run('演示王老师', phone, hash, 'teacher');

const cls = db.prepare('INSERT INTO classes (teacher_id, name, subject, description, color, invite_code) VALUES (?, ?, ?, ?, ?, ?)')
  .run(teacher.lastInsertRowid, '初二物理培优班', '物理', '力学与电学专题提升', '#00B8A9', 'DEMO66');

const addStudent = db.prepare('INSERT INTO students (class_id, name, phone) VALUES (?, ?, ?)');
const studentIds = ['陈小明', '林小雨', '赵子轩', '王一诺'].map((name) =>
  addStudent.run(cls.lastInsertRowid, name, '').lastInsertRowid
);

const addLesson = db.prepare('INSERT INTO lessons (class_id, date, start_time, duration_min, room, topic, status) VALUES (?, ?, ?, ?, ?, ?, ?)');

// 昨天：已完成的课（含签到与记录）
const yesterday = addDays(today(), -1);
const past = addLesson.run(cls.lastInsertRowid, yesterday, '18:30', 90, '301教室', '牛顿第二定律应用', 'done').lastInsertRowid;
const mark = db.prepare('INSERT INTO attendance (lesson_id, student_id, status) VALUES (?, ?, ?)');
mark.run(past, studentIds[0], 'present');
mark.run(past, studentIds[1], 'late');
mark.run(past, studentIds[2], 'present');
mark.run(past, studentIds[3], 'absent');
db.prepare('INSERT INTO lesson_records (lesson_id, content, homework) VALUES (?, ?, ?)')
  .run(past, '讲解牛顿第二定律典型题型，完成例题 6 道。', '练习册 P45-46 第 1-8 题');

// 今天起每周一次，共 4 次
for (let i = 0; i < 4; i++) {
  addLesson.run(cls.lastInsertRowid, addDays(today(), i * 7), '18:30', 90, '301教室', i === 0 ? '功与功率' : '', 'scheduled');
}

console.log('演示数据创建完成：');
console.log('  教师登录: 13800000001 / demo123456');
console.log('  班级邀请码: DEMO66（可用于学生注册后加入班级）');
