import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { authRequired, signToken, setAuthCookie, clearAuthCookie } from '../middleware.js';
import { h, ApiError } from '../util.js';

const router = Router();

function publicUser(u) {
  return { id: u.id, name: u.name, phone: u.phone, role: u.role, status: u.status, created_at: u.created_at };
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

  // 部署时可用 EDUHUB_SUPER_PHONE 指定一个手机号，注册即成为超级管理员
  const superPhone = String(process.env.EDUHUB_SUPER_PHONE || '').trim();
  const finalRole = superPhone && String(phone) === superPhone ? 'super' : role;

  const hash = bcrypt.hashSync(String(password), 10);
  const r = db.prepare('INSERT INTO users (name, phone, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(String(name).trim(), String(phone), hash, finalRole);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  const token = signToken(user);
  setAuthCookie(res, token);
  res.status(201).json({ token, user: publicUser(user) });
}));

router.post('/login', h(async (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) throw new ApiError(400, '请填写手机号和密码');
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(String(phone));
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    throw new ApiError(400, '手机号或密码不正确');
  }
  if (user.status === 'disabled') throw new ApiError(403, '账号已被停用，请联系管理员');
  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ token, user: publicUser(user) });
}));

/** 退出登录：清掉图片鉴权用的 Cookie */
router.post('/logout', h(async (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
}));

router.get('/me', authRequired, h(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) throw new ApiError(401, '用户不存在');
  // 顺带续期 Cookie，避免长期使用时图片突然 401
  setAuthCookie(res, signToken(user));
  res.json({ user: publicUser(user) });
}));

export default router;
