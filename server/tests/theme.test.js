import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EDUHUB_DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-theme';

const { createApp } = await import('../src/app.js');

const app = createApp();
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

let token;

async function api(method, path, tok, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

describe('用户主题（亮色 / 暗色 / 跟随系统）', () => {
  after(() => server.close());

  it('注册后默认跟随系统', async () => {
    const r = await api('POST', '/api/auth/register', null, {
      name: '主题同学', phone: '13950000001', password: '123456', role: 'teacher',
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.user.theme, 'system');
    token = r.data.token;
  });

  it('设置为暗色并回读', async () => {
    const put = await api('PUT', '/api/auth/theme', token, { theme: 'dark' });
    assert.equal(put.status, 200);
    assert.equal(put.data.user.theme, 'dark');

    const me = await api('GET', '/api/auth/me', token);
    assert.equal(me.data.user.theme, 'dark');
  });

  it('亮色与跟随系统都能设置', async () => {
    assert.equal((await api('PUT', '/api/auth/theme', token, { theme: 'light' })).data.user.theme, 'light');
    assert.equal((await api('PUT', '/api/auth/theme', token, { theme: 'system' })).data.user.theme, 'system');
  });

  it('非法值被拒绝', async () => {
    const bad = await api('PUT', '/api/auth/theme', token, { theme: 'blue' });
    assert.equal(bad.status, 400);
    const empty = await api('PUT', '/api/auth/theme', token, {});
    assert.equal(empty.status, 400);
  });

  it('未登录不能改主题', async () => {
    const r = await api('PUT', '/api/auth/theme', null, { theme: 'dark' });
    assert.equal(r.status, 401);
  });

  it('主题随登录返回（跨设备生效）', async () => {
    await api('PUT', '/api/auth/theme', token, { theme: 'dark' });
    const login = await api('POST', '/api/auth/login', null, { phone: '13950000001', password: '123456' });
    assert.equal(login.data.user.theme, 'dark');
  });
});
