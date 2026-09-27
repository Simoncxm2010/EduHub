import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EDUHUB_DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';

const { createApp } = await import('../src/app.js');
const { today } = await import('../src/db.js');
const { addDays } = await import('../src/util.js');

const app = createApp();
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function api(method, path, token, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

let teacherToken, studentToken, classId, inviteCode, lessonId;

describe('师枢 EduHub API', () => {
  before(() => {});

  after(() => server.close());

  it('健康检查', async () => {
    const r = await api('GET', '/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
  });

  it('未登录访问受保护接口返回 401', async () => {
    const r = await api('GET', '/api/classes');
    assert.equal(r.status, 401);
  });

  it('教师注册', async () => {
    const r = await api('POST', '/api/auth/register', null, {
      name: '测试老师', phone: '13900000001', password: '123456', role: 'teacher',
    });
    assert.equal(r.status, 201);
    assert.ok(r.data.token);
    teacherToken = r.data.token;
  });

  it('密码错误登录失败', async () => {
    const r = await api('POST', '/api/auth/login', null, { phone: '13900000001', password: 'wrong!' });
    assert.equal(r.status, 400);
  });

  it('登录成功并获取个人信息', async () => {
    const r = await api('POST', '/api/auth/login', null, { phone: '13900000001', password: '123456' });
    assert.equal(r.status, 200);
    assert.ok(r.data.token);
    teacherToken = r.data.token;
    const me = await api('GET', '/api/auth/me', teacherToken);
    assert.equal(me.status, 200);
    assert.equal(me.data.user.role, 'teacher');
  });

  it('创建班级并生成邀请码', async () => {
    const r = await api('POST', '/api/classes', teacherToken, {
      name: '高一数学培优班', subject: '数学', description: '函数与导数专题',
    });
    assert.equal(r.status, 201);
    assert.ok(r.data.class.invite_code);
    classId = r.data.class.id;
    inviteCode = r.data.class.invite_code;
  });

  it('教师手动添加两名学生', async () => {
    for (const name of ['张三', '李四']) {
      const r = await api('POST', `/api/classes/${classId}/students`, teacherToken, { name });
      assert.equal(r.status, 201);
    }
  });

  it('学生注册并凭邀请码加入班级', async () => {
    const reg = await api('POST', '/api/auth/register', null, {
      name: '王同学', phone: '13900000002', password: '123456', role: 'student',
    });
    assert.equal(reg.status, 201);
    studentToken = reg.data.token;
    const join = await api('POST', '/api/classes/join', studentToken, { invite_code: inviteCode });
    assert.equal(join.status, 201);
    const list = await api('GET', '/api/classes', studentToken);
    assert.equal(list.data.classes.length, 1);
  });

  it('教师新建课时（每周重复 2 次）', async () => {
    const r = await api('POST', '/api/lessons', teacherToken, {
      class_id: classId, date: today(), start_time: '18:30', duration_min: 90, room: '301', topic: '函数图像', repeat_weeks: 2,
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.lessons.length, 2);
    lessonId = r.data.lessons[0].id;
  });

  it('按日期范围查询课时', async () => {
    const r = await api('GET', `/api/lessons?from=${addDays(today(), -1)}&to=${addDays(today(), 14)}`, teacherToken);
    assert.equal(r.status, 200);
    assert.ok(r.data.lessons.length >= 2);
  });

  it('课时详情包含名单与签到', async () => {
    const r = await api('GET', `/api/lessons/${lessonId}`, teacherToken);
    assert.equal(r.status, 200);
    assert.equal(r.data.students.length, 3); // 两名手动登记 + 一名学生账号
    assert.equal(r.data.attendance.length, 0);
  });

  it('保存签到', async () => {
    const detail = await api('GET', `/api/lessons/${lessonId}`, teacherToken);
    const [s1, s2] = detail.data.students;
    const r = await api('PUT', `/api/lessons/${lessonId}/attendance`, teacherToken, {
      items: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'absent' },
      ],
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.attendance.length, 2);
  });

  it('保存课堂记录', async () => {
    const r = await api('PUT', `/api/lessons/${lessonId}/record`, teacherToken, {
      content: '讲解了函数平移变换', homework: '课本 P32 1-5 题',
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.record.content, '讲解了函数平移变换');
  });

  it('学生可以查看课时详情但不能修改', async () => {
    const view = await api('GET', `/api/lessons/${lessonId}`, studentToken);
    assert.equal(view.status, 200);
    assert.ok(view.data.record);
    const forbid = await api('PUT', `/api/lessons/${lessonId}/record`, studentToken, { content: 'x' });
    assert.equal(forbid.status, 403);
  });

  it('学生无法创建班级或课时', async () => {
    const a = await api('POST', '/api/classes', studentToken, { name: 'x' });
    assert.equal(a.status, 403);
    const b = await api('POST', '/api/lessons', studentToken, { class_id: classId, date: today(), start_time: '10:00' });
    assert.equal(b.status, 403);
  });

  it('教师仪表盘概览', async () => {
    const r = await api('GET', '/api/lessons/dashboard/overview', teacherToken);
    assert.equal(r.status, 200);
    assert.equal(r.data.stats.class_count, 1);
    assert.ok(r.data.today_lessons.length >= 1);
  });

  it('学生仪表盘概览', async () => {
    const r = await api('GET', '/api/lessons/dashboard/overview', studentToken);
    assert.equal(r.status, 200);
    assert.ok(r.data.stats.week_lessons >= 1);
  });

  it('更新课时状态为已完成', async () => {
    const r = await api('PUT', `/api/lessons/${lessonId}`, teacherToken, { status: 'done' });
    assert.equal(r.status, 200);
    assert.equal(r.data.lesson.status, 'done');
  });
});
