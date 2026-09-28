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
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret());
  } catch {
    throw new ApiError(401, '登录已过期，请重新登录');
  }
  // 账号可能被管理员停用或角色被调整，每次都按库里最新状态来
  const user = db.prepare('SELECT id, name, phone, role, status FROM users WHERE id = ?').get(payload.uid);
  if (!user) throw new ApiError(401, '用户不存在');
  if (user.status === 'disabled') throw new ApiError(403, '账号已被停用，请联系管理员');
  req.user = user;
  next();
}

/** 角色等级：数字越大权限越高 */
export const ROLE_LEVEL = { student: 1, teacher: 2, admin: 3, super: 4 };

export function roleAtLeast(user, min) {
  return (ROLE_LEVEL[user?.role] || 0) >= (ROLE_LEVEL[min] || 99);
}

/** 管理员及以上 */
export function adminOnly(req, res, next) {
  if (!roleAtLeast(req.user, 'admin')) throw new ApiError(403, '该操作需要管理员权限');
  next();
}

/** 仅超级管理员 */
export function superOnly(req, res, next) {
  if (req.user?.role !== 'super') throw new ApiError(403, '该操作仅限超级管理员');
  next();
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

/** 教学类操作：教师及以上都可以（管理员/超管往往也代课） */
export function teacherOnly(req, res, next) {
  if (!roleAtLeast(req.user, 'teacher')) throw new ApiError(403, '该操作仅限教师及以上角色');
  next();
}

/** 仅学生可操作 */
export function studentOnly(req, res, next) {
  if (req.user?.role !== 'student') throw new ApiError(403, '该操作仅限学生');
  next();
}

/** 校验班级访问权限：教师必须是班级所有者；学生必须在班级中（students.user_id）；
 *  管理员及以上可查看任意班级 */
export function assertClassAccess(user, classId) {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!cls) throw new ApiError(404, '班级不存在');
  if (roleAtLeast(user, 'admin')) return cls;
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
