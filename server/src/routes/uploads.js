import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { uploadsDir } from '../db.js';
import { authRequired } from '../middleware.js';
import { h, ApiError } from '../util.js';

const router = Router();
router.use(authRequired);

const LIMITS = { photo: 6 * 1024 * 1024, signature: 1024 * 1024 };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * 接收前端压缩后的图片（data URL），落盘并返回可访问地址。
 * 照片与签名都存成文件，数据库只留 URL，避免库文件被 base64 撑大。
 */
router.post('/', h(async (req, res) => {
  const { data, kind = 'photo' } = req.body || {};
  const limit = LIMITS[kind] || LIMITS.photo;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(data || ''));
  if (!match) throw new ApiError(400, '图片格式不正确，请重新拍摄或签名');

  const buf = Buffer.from(match[2], 'base64');
  if (!buf.length) throw new ApiError(400, '图片内容为空');
  if (buf.length > limit) {
    throw new ApiError(413, `图片过大，请压缩后重试（上限 ${Math.round(limit / 1024 / 1024)}MB）`);
  }

  const name = `${Date.now().toString(36)}-${crypto.randomUUID()}.${EXT[match[1]]}`;
  fs.writeFileSync(path.join(uploadsDir, name), buf);
  res.status(201).json({ url: `/uploads/${name}`, size: buf.length });
}));

export default router;
