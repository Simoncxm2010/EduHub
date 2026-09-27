import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import classRoutes from './routes/classes.js';
import lessonRoutes from './routes/lessons.js';
import { ApiError } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, name: '师枢 EduHub', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/classes', classRoutes);
  app.use('/api/lessons', lessonRoutes);
  app.use('/api', (req, res) => res.status(404).json({ message: '接口不存在' }));

  // 生产模式：托管前端构建产物（web/dist），未登录路径回退到 index.html
  const dist = path.join(__dirname, '../../web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
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
