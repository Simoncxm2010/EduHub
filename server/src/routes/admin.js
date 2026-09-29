import { Router } from 'express';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, dbPath, uploadsDir } from '../db.js';
import { authRequired, adminOnly, superOnly, ROLE_LEVEL } from '../middleware.js';
import { h, ApiError } from '../util.js';

const router = Router();
router.use(authRequired, adminOnly);

const ROLES = ['student', 'teacher', 'admin', 'super'];
const ROLE_CN = { student: '学生', teacher: '教师', admin: '管理员', super: '超级管理员' };
/** 计入审计的敏感动作（超管可按此筛选审计日志） */
const AUDIT_ACTIONS = ['create_user', 'set_role', 'set_status', 'reset_password', 'delete_user'];

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    role: u.role,
    role_cn: ROLE_CN[u.role] || u.role,
    status: u.status,
    created_at: u.created_at,
    class_count: u.class_count ?? undefined,
    student_count: u.student_count ?? undefined,
    lesson_count: u.lesson_count ?? undefined,
  };
}

/**
 * 审计：管理员敏感操作落库（建号/改角色/启停用/重置密码/删号）。
 * 仅超管（运维/开发）可查——机构管理员的日常操作对普通管理员不可见。
 */
function logAudit(req, action, target, detail = '') {
  try {
    db.prepare(`
      INSERT INTO audit_logs (operator_id, operator_name, operator_role, action, target_id, target_name, detail)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id, req.user.name, req.user.role, action,
      target?.id ?? null, target?.name ?? '', String(detail).slice(0, 300)
    );
  } catch {
    // 审计失败不阻断主流程
  }
}

/** 系统概览 */
router.get('/stats', h(async (req, res) => {
  const byRole = db.prepare('SELECT role, COUNT(*) AS n FROM users GROUP BY role').all();
  const roles = { student: 0, teacher: 0, admin: 0, super: 0 };
  for (const r of byRole) roles[r.role] = r.n;

  res.json({
    roles,
    total_users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    disabled_users: db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'disabled'").get().n,
    classes: db.prepare('SELECT COUNT(*) AS n FROM classes').get().n,
    students: db.prepare('SELECT COUNT(*) AS n FROM students').get().n,
    lessons: db.prepare('SELECT COUNT(*) AS n FROM lessons').get().n,
    lessons_done: db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE status = 'done'").get().n,
    pending_requests: db.prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'pending'").get().n,
    uploads: db.prepare(
      "SELECT COUNT(*) AS n FROM lessons WHERE checkin_photo IS NOT NULL OR teacher_signature IS NOT NULL"
    ).get().n,
  });
}));

/** 用户列表：支持按角色与关键字筛选 */
router.get('/users', h(async (req, res) => {
  const conds = [];
  const params = [];
  if (req.query.role && ROLES.includes(req.query.role)) {
    conds.push('u.role = ?');
    params.push(req.query.role);
  }
  if (req.query.status && ['active', 'disabled'].includes(req.query.status)) {
    conds.push('u.status = ?');
    params.push(req.query.status);
  }
  const q = String(req.query.q || '').trim();
  if (q) {
    conds.push('(u.name LIKE ? OR u.phone LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

  const rows = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM classes c WHERE c.teacher_id = u.id) AS class_count,
      (SELECT COUNT(*) FROM students s WHERE s.user_id = u.id) AS student_count
    FROM users u
    ${where}
    ORDER BY CASE u.role WHEN 'super' THEN 0 WHEN 'admin' THEN 1 WHEN 'teacher' THEN 2 ELSE 3 END,
             u.created_at DESC
    LIMIT ?
  `).all(...params, limit);

  res.json({ users: rows.map(publicUser), roles: ROLE_CN });
}));

/** 修改角色：管理员只能调整教师/学生；超管才能涉及管理员与超管 */
router.put('/users/:id/role', h(async (req, res) => {
  const id = Number(req.params.id);
  const role = String(req.body?.role || '');
  if (!ROLES.includes(role)) throw new ApiError(400, '角色不正确');

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) throw new ApiError(404, '用户不存在');
  if (target.id === req.user.id) throw new ApiError(400, '不能修改自己的角色');

  const isSuper = req.user.role === 'super';
  const touchesPrivileged = role === 'admin' || role === 'super' || target.role === 'admin' || target.role === 'super';
  if (touchesPrivileged && !isSuper) throw new ApiError(403, '只有超级管理员可以分配管理员或超管权限');
  if (target.role === 'super' && !isSuper) throw new ApiError(403, '无权修改超级管理员');

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  logAudit(req, 'set_role', target, `${target.role} → ${role}`);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ user: publicUser(updated) });
}));

/** 启用 / 停用账号 */
router.put('/users/:id/status', h(async (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '');
  if (!['active', 'disabled'].includes(status)) throw new ApiError(400, '状态不正确');

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) throw new ApiError(404, '用户不存在');
  if (target.id === req.user.id) throw new ApiError(400, '不能停用自己的账号');
  // 不能动同级或更高级别的人
  if (ROLE_LEVEL[target.role] >= ROLE_LEVEL[req.user.role]) {
    throw new ApiError(403, `无权操作${ROLE_CN[target.role]}账号`);
  }

  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
  logAudit(req, 'set_status', target, `账号${status === 'active' ? '启用' : '停用'}`);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ user: publicUser(updated) });
}));

/** 重置密码 */
router.put('/users/:id/password', h(async (req, res) => {
  const id = Number(req.params.id);
  const password = String(req.body?.password || '');
  if (password.length < 6) throw new ApiError(400, '新密码至少 6 位');

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) throw new ApiError(404, '用户不存在');
  if (ROLE_LEVEL[target.role] > ROLE_LEVEL[req.user.role]) throw new ApiError(403, '无权修改该账号的密码');

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), id);
  logAudit(req, 'reset_password', target);
  res.json({ ok: true });
}));

/** 新建账号：管理员可直接代开教师/学生账号 */
router.post('/users', h(async (req, res) => {
  const b = req.body || {};
  const role = String(b.role || 'student');
  if (!ROLES.includes(role)) throw new ApiError(400, '角色不正确');
  if (role === 'admin' || role === 'super') {
    if (req.user.role !== 'super') throw new ApiError(403, '只有超级管理员可以创建管理员账号');
  }
  if (!String(b.name || '').trim()) throw new ApiError(400, '请填写姓名');
  if (!/^\d{5,20}$/.test(String(b.phone || ''))) throw new ApiError(400, '手机号格式不正确');
  if (String(b.password || '').length < 6) throw new ApiError(400, '密码至少 6 位');
  if (db.prepare('SELECT id FROM users WHERE phone = ?').get(String(b.phone))) {
    throw new ApiError(400, '该手机号已存在');
  }

  const r = db.prepare(
    'INSERT INTO users (name, phone, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(String(b.name).trim(), String(b.phone), bcrypt.hashSync(String(b.password), 10), role);
  const created = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  logAudit(req, 'create_user', created, `角色：${ROLE_CN[role] || role}`);
  res.status(201).json({ user: publicUser(created) });
}));

/** 删除账号（仅超管，且不能删除自己与其他超管） */
router.delete('/users/:id', superOnly, h(async (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) throw new ApiError(404, '用户不存在');
  if (target.id === req.user.id) throw new ApiError(400, '不能删除自己的账号');
  if (target.role === 'super') throw new ApiError(403, '不能删除超级管理员账号');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  logAudit(req, 'delete_user', target);
  res.json({ ok: true });
}));

/** 全部班级一览（管理员视角） */
router.get('/classes', h(async (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, u.name AS teacher_name, u.phone AS teacher_phone,
      (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) AS student_count,
      (SELECT COUNT(*) FROM lessons l WHERE l.class_id = c.id) AS lesson_count
    FROM classes c JOIN users u ON u.id = c.teacher_id
    ORDER BY c.created_at DESC
    LIMIT 500
  `).all();
  res.json({ classes: rows });
}));

/**
 * 系统信息（仅超管——运维/开发领地）：运行环境、数据库与上传目录体积、业务量。
 * 普通管理员（机构管理者）看不到这些，避免把运维细节暴露给日常管理。
 */
router.get('/system', superOnly, h(async (req, res) => {
  const stat = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
  const dirStat = (dir) => {
    try {
      const files = fs.readdirSync(dir);
      const size = files.reduce((n, f) => n + stat(path.join(dir, f)), 0);
      return { count: files.length, size };
    } catch {
      return { count: 0, size: 0 };
    }
  };
  const uploads = dirStat(uploadsDir);
  const mu = process.memoryUsage();

  res.json({
    node: process.version,
    platform: `${os.platform()} ${os.arch()}`,
    uptime_s: Math.round(process.uptime()),
    memory: {
      rss_mb: Math.round(mu.rss / 1048576),
      heap_used_mb: Math.round(mu.heapUsed / 1048576),
    },
    db_size: stat(dbPath),
    uploads,
    counts: {
      users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      disabled_users: db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'disabled'").get().n,
      classes: db.prepare('SELECT COUNT(*) AS n FROM classes').get().n,
      students: db.prepare('SELECT COUNT(*) AS n FROM students').get().n,
      lessons: db.prepare('SELECT COUNT(*) AS n FROM lessons').get().n,
      lessons_done: db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE status = 'done'").get().n,
      pending_requests: db.prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'pending'").get().n,
    },
  });
}));

/** 审计日志（仅超管）：管理员的建号/改角色/启停用/重置密码/删号记录 */
router.get('/audit', superOnly, h(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const action = String(req.query.action || '');
  const conds = [];
  const params = [];
  if (action && AUDIT_ACTIONS.includes(action)) {
    conds.push('action = ?');
    params.push(action);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_logs ${where}`).get(...params).n;
  res.json({ logs: rows, total, actions: AUDIT_ACTIONS });
}));

export default router;
