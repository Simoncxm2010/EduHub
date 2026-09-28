// 创建或提升超级管理员账号
//   node src/seed-super.js 13800000000 密码123456 "张校长"
//   node src/seed-super.js 13800000000            # 提升已有账号为超管
import bcrypt from 'bcryptjs';
import { db } from './db.js';

const phone = process.argv[2];
const password = process.argv[3];
const name = process.argv[4];

if (!phone) {
  console.log('用法: node src/seed-super.js <手机号> [密码] [姓名]');
  console.log('  带密码 = 创建新超管；不带密码 = 把已有账号提升为超管');
  process.exit(1);
}

const existing = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);

if (existing) {
  db.prepare("UPDATE users SET role = 'super', status = 'active' WHERE id = ?").run(existing.id);
  console.log(`已把「${existing.name}」（${phone}）提升为超级管理员。`);
} else {
  if (!password || password.length < 6) {
    console.error('账号不存在，创建新账号需要提供至少 6 位的密码。');
    process.exit(1);
  }
  const r = db.prepare('INSERT INTO users (name, phone, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name || '超级管理员', phone, bcrypt.hashSync(password, 10), 'super');
  console.log(`已创建超级管理员：${name || '超级管理员'}（${phone}），ID=${r.lastInsertRowid}`);
}
console.log('现在可以用该手机号登录，并在「管理后台」里分配角色与权限。');
