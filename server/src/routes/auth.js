import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { authRequired, signToken } from '../middleware.js';
import { h, ApiError } from '../util.js';

const router = Router();

function publicUser(u) {
  return { id: u.id, name: u.name, phone: u.phone, role: u.role, created_at: u.created_at };
}

function validateRegister({ name, phone, password, role }) {
  if (!name || !String(name).trim()) throw new ApiError(400, '请填写姓名');
  if (!phone || !/^\d{5,20}$/.test(String(phone))) throw new ApiError(400, '手机号/账号格式不正确');
  if (!password || String(password).length < 6) throw new ApiError(400, '密码至少 6 位');
  if (role !== 'teacher' && role !== 'student') throw new ApiError(400, '请选择身份');
}

router.post('/register', h(async (req, res) => {
  const { name, phone, password, role } = req.body || {};
  validateRegister({ name, phone, password, role });
  const exists = db.prepare('SELECT id FROM users WHERE phone = ?').get(String(phone));
  if (exists) throw new ApiError(400, '该手机号已注册，请直接登录');
  const hash = bcrypt.hashSync(String(password), 10);
  const r = db.prepare('INSERT INTO users (name, phone, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(String(name).trim(), String(phone), hash, role);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

router.post('/login', h(async (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) throw new ApiError(400, '请填写手机号和密码');
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(String(phone));
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    throw new ApiError(400, '手机号或密码不正确');
  }
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get('/me', authRequired, h(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) throw new ApiError(401, '用户不存在');
  res.json({ user: publicUser(user) });
}));

export default router;
