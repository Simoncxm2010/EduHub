import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { ApiError } from './util.js';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _secret;
export function jwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (_secret) return _secret;
  const file = path.join(__dirname, '../data/.jwt_secret');
  try {
    _secret = fs.readFileSync(file, 'utf8').trim();
  } catch {
    _secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, _secret, { mode: 0o600 });
  }
  return _secret;
}

/**
 * 登录令牌来源：优先 Authorization 头（前端 API 调用），
 * 回退到 httpOnly Cookie —— <img src="/uploads/..."> 这类请求带不了请求头，
 * 只能靠 Cookie 才能给照片与签名加上鉴权。
 */
function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  const cookie = req.headers.cookie || '';
  const match = /(?:^|;\s*)eduhub_token=([^;]+)/.exec(cookie);
  return match ? decodeURIComponent(match[1]) : null;
}

/** 要求已登录 */
export function authRequired(req, res, next) {
  const token = readToken(req);
  if (!token) throw new ApiError(401, '请先登录');
  try {
    const payload = jwt.verify(token, jwtSecret());
    req.user = { id: payload.uid, role: payload.role, name: payload.name, phone: payload.phone };
    next();
  } catch {
    throw new ApiError(401, '登录已过期，请重新登录');
  }
}

export const COOKIE_NAME = 'eduhub_token';

/** 登录后同时下发 httpOnly Cookie，供图片等无法带请求头的场景使用 */
export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 3600 * 1000,
    secure: process.env.COOKIE_SECURE === '1',
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** 仅教师可操作 */
export function teacherOnly(req, res, next) {
  if (req.user?.role !== 'teacher') throw new ApiError(403, '该操作仅限教师');
  next();
}

/** 仅学生可操作 */
export function studentOnly(req, res, next) {
  if (req.user?.role !== 'student') throw new ApiError(403, '该操作仅限学生');
  next();
}

/** 校验班级访问权限：教师必须是班级所有者；学生必须在班级中（students.user_id） */
export function assertClassAccess(user, classId) {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!cls) throw new ApiError(404, '班级不存在');
  if (user.role === 'teacher') {
    if (cls.teacher_id !== user.id) throw new ApiError(403, '无权访问该班级');
  } else {
    const mine = db.prepare('SELECT id FROM students WHERE class_id = ? AND user_id = ?').get(classId, user.id);
    if (!mine) throw new ApiError(403, '你不在该班级中');
  }
  return cls;
}

/** 签发登录令牌 */
export function signToken(user) {
  return jwt.sign(
    { uid: user.id, role: user.role, name: user.name, phone: user.phone },
    jwtSecret(),
    { expiresIn: '30d' }
  );
}
