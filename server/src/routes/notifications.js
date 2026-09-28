import { Router } from 'express';
import { db } from '../db.js';
import { authRequired } from '../middleware.js';
import { h, ApiError } from '../util.js';

const router = Router();
router.use(authRequired);

/** 给用户插一条通知；user_id 为空（手动登记的学生）就静默跳过 */
export function notify(userId, title, body = '', link = '') {
  if (!userId) return;
  try {
    db.prepare('INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)')
      .run(userId, String(title).slice(0, 120), String(body).slice(0, 500), String(link).slice(0, 200));
    // 每人最多留 100 条，防止无限增长
    db.prepare(`
      DELETE FROM notifications WHERE user_id = ? AND id NOT IN (
        SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100
      )
    `).run(userId, userId);
  } catch {
    // 通知失败不影响主流程
  }
}

/** 通知列表（新→旧）+ 未读数 */
router.get('/', h(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const rows = db.prepare(
    'SELECT id, title, body, link, read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?'
  ).all(req.user.id, limit);
  const unread = db.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0'
  ).get(req.user.id).n;
  res.json({ notifications: rows, unread_count: unread });
}));

/** 标记已读：{ ids: [] } 或 { all: true } */
router.post('/read', h(async (req, res) => {
  const b = req.body || {};
  if (b.all) {
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(req.user.id);
  } else if (Array.isArray(b.ids) && b.ids.length) {
    const ids = b.ids.map(Number).filter(Number.isInteger).slice(0, 200);
    const stmt = db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?');
    db.exec('BEGIN');
    try {
      for (const id of ids) stmt.run(req.user.id, id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } else {
    throw new ApiError(400, '请指定要标记的通知');
  }
  const unread = db.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0'
  ).get(req.user.id).n;
  res.json({ ok: true, unread_count: unread });
}));

/** 全部清空 */
router.delete('/', h(async (req, res) => {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
}));

export default router;
