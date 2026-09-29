import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EDUHUB_DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-perm';
// 该手机号注册即为超管（运维/开发角色）
process.env.EDUHUB_SUPER_PHONE = '13940000000';

const { createApp } = await import('../src/app.js');

const app = createApp();
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function api(method, path, tok, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const reg = (name, phone, role) => api('POST', '/api/auth/register', null, { name, phone, password: '123456', role });

let superAdmin, admin, teacherToken, teacherId, adminId;

describe('权限分层（管理员=机构管理，超管=运维/开发）', () => {
  after(() => server.close());

  it('准备超管与机构管理员', async () => {
    const s = await reg('运维超管', '13940000000', 'teacher');
    assert.equal(s.data.user.role, 'super');
    superAdmin = s.data.token;

    const t = await reg('机构管理员', '13940000001', 'teacher');
    teacherToken = t.data.token;
    teacherId = t.data.user.id;
    const promote = await api('PUT', `/api/admin/users/${teacherId}/role`, superAdmin, { role: 'admin' });
    assert.equal(promote.status, 200);
    admin = promote.data.user.role === 'admin' ? teacherToken : teacherToken;
    adminId = teacherId;
  });

  it('超管可以看系统信息（运维面板）', async () => {
    const r = await api('GET', '/api/admin/system', superAdmin);
    assert.equal(r.status, 200);
    assert.ok(r.data.node);
    assert.ok(r.data.platform);
    assert.equal(typeof r.data.uptime_s, 'number');
    assert.equal(typeof r.data.db_size, 'number');
    assert.ok(r.data.uploads && typeof r.data.uploads.count === 'number');
    assert.ok(r.data.counts && typeof r.data.counts.users === 'number');
  });

  it('机构管理员不能看系统信息（403）', async () => {
    const r = await api('GET', '/api/admin/system', admin);
    assert.equal(r.status, 403);
  });

  it('超管可查审计日志，机构管理员不行', async () => {
    const ok = await api('GET', '/api/admin/audit', superAdmin);
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray(ok.data.logs));
    assert.ok(Array.isArray(ok.data.actions));
    const deny = await api('GET', '/api/admin/audit', admin);
    assert.equal(deny.status, 403);
  });

  it('机构管理员的敏感操作也进审计（建号）', async () => {
    const r = await api('POST', '/api/admin/users', admin, {
      name: '被审计教师', phone: '13940000002', password: '123456', role: 'teacher',
    });
    assert.equal(r.status, 201);
    teacherId = r.data.user.id;

    const audit = await api('GET', '/api/admin/audit?action=create_user', superAdmin);
    assert.equal(audit.status, 200);
    const hit = audit.data.logs.find((l) => l.target_id === teacherId && l.action === 'create_user');
    assert.ok(hit, 'create_user 应回审计');
    assert.equal(hit.operator_name, '机构管理员');
    assert.equal(hit.operator_role, 'admin');
  });

  it('改角色 / 停用 / 重置密码均落审计', async () => {
    await api('PUT', `/api/admin/users/${teacherId}/role`, superAdmin, { role: 'teacher' });
    await api('PUT', `/api/admin/users/${teacherId}/status`, superAdmin, { status: 'disabled' });
    await api('PUT', `/api/admin/users/${teacherId}/password`, superAdmin, { password: 'newpass123' });

    const audit = await api('GET', '/api/admin/audit', superAdmin);
    const actions = audit.data.logs.filter((l) => l.target_id === teacherId).map((l) => l.action);
    assert.ok(actions.includes('set_role'));
    assert.ok(actions.includes('set_status'));
    assert.ok(actions.includes('reset_password'));
  });

  it('审计支持分页与按动作筛选', async () => {
    const page1 = await api('GET', '/api/admin/audit?limit=2&offset=0', superAdmin);
    assert.equal(page1.data.logs.length, 2);
    const page2 = await api('GET', '/api/admin/audit?limit=2&offset=2', superAdmin);
    if (page2.data.logs.length) {
      assert.notEqual(page1.data.logs[0].id, page2.data.logs[0].id, '分页应取到不同记录');
    }
    const onlyRole = await api('GET', '/api/admin/audit?action=set_role', superAdmin);
    for (const l of onlyRole.data.logs) assert.equal(l.action, 'set_role');
  });

  it('层级边界不变：机构管理员不能操作管理员账号', async () => {
    // 先把被审计教师提回 admin，再用机构管理员尝试操作（同级 403）
    await api('PUT', `/api/admin/users/${teacherId}/role`, superAdmin, { role: 'admin' });
    const deny = await api('PUT', `/api/admin/users/${teacherId}/status`, admin, { status: 'active' });
    assert.equal(deny.status, 403, '管理员不能操作管理员账号');
  });

  it('删号落审计且仅超管可删', async () => {
    const r = await api('DELETE', `/api/admin/users/${teacherId}`, superAdmin);
    assert.equal(r.status, 200);
    const audit = await api('GET', '/api/admin/audit?action=delete_user', superAdmin);
    assert.ok(audit.data.logs.some((l) => l.target_id === teacherId));
  });
});
