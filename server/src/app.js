import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import classRoutes from './routes/classes.js';
import lessonRoutes from './routes/lessons.js';
import uploadRoutes from './routes/uploads.js';
import requestRoutes from './routes/requests.js';
import availabilityRoutes from './routes/availability.js';
import calendarRoutes from './routes/calendar.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';
import { uploadsDir } from './db.js';
import { authRequired } from './middleware.js';
import { ApiError } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  // 反向代理（Nginx 等）后面才能拿到正确的协议，secure Cookie 需要
  app.set('trust proxy', 1);
  // 图片上传单独放宽 body 上限，其余接口维持 1mb
  app.use('/api/uploads', express.json({ limit: '12mb' }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, name: '师枢 EduHub', time: new Date().toISOString() });
  });

  // 课堂照片与学生签名属于隐私内容，必须登录后才能读取
  // （<img> 带不了请求头，鉴权走登录时下发的 httpOnly Cookie）
  app.use('/uploads', authRequired, express.static(uploadsDir, { maxAge: '7d', immutable: true }));

  app.use('/api/auth', authRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/classes', classRoutes);
  app.use('/api/lessons', lessonRoutes);
  app.use('/api/requests', requestRoutes);
  app.use('/api/availability', availabilityRoutes);
  app.use('/api/calendar', calendarRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api', (req, res) => res.status(404).json({ message: '接口不存在' }));

  // 生产模式：托管前端构建产物（web/dist），未登录路径回退到 index.html
  const dist = path.join(__dirname, '../../web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  // 统一错误处理
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ message: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ message: '请求体 JSON 格式错误' });
    console.error(err);
    res.status(500).json({ message: '服务器内部错误' });
  });

  return app;
}
