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

/** 要求已登录，解析 Bearer Token */
export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new ApiError(401, '请先登录');
  try {
    const payload = jwt.verify(token, jwtSecret());
    req.user = { id: payload.uid, role: payload.role, name: payload.name };
    next();
  } catch {
    throw new ApiError(401, '登录已过期，请重新登录');
  }
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
  return jwt.sign({ uid: user.id, role: user.role, name: user.name }, jwtSecret(), { expiresIn: '30d' });
}
