import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EDUHUB_DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-v3';

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

const reg = (name, phone, role) => api('POST', '/api/auth/register', null, { name, phone, password: '123456', role });

let teacher, student, classId, inviteCode, lessonId, requestId, notificationId;

describe('师枢 v0.5 通知与收费统计', () => {
  after(() => server.close());

  it('准备教师、班级、课程与学生', async () => {
    teacher = (await reg('收费王老师', '13910000001', 'teacher')).data.token;
    const cls = await api('POST', '/api/classes', teacher, { name: '小升初数学班', subject: '数学', rate: 150 });
    classId = cls.data.class.id;
    inviteCode = cls.data.class.invite_code;

    const s = await reg('收费同学', '13910000002', 'student');
    student = s.data.token;
    await api('POST', '/api/classes/join', student, { invite_code: inviteCode });

    const lesson = await api('POST', '/api/lessons', teacher, {
      class_id: classId, date: addDays(today(), 2), start_time: '18:30', duration_min: 90,
    });
    lessonId = lesson.data.lessons[0].id;
    await api('PUT', `/api/lessons/${lessonId}`, teacher, { status: 'done' });
  });

  it('学生提交请假会通知老师', async () => {
    const r = await api('POST', '/api/requests', student, { kind: 'leave', lesson_id: lessonId, reason: '身体不适' });
    assert.equal(r.status, 201);
    requestId = r.data.request.id;

    const n = await api('GET', '/api/notifications', teacher);
    assert.equal(n.status, 200);
    assert.ok(n.data.unread_count >= 1);
    const item = n.data.notifications.find((x) => x.title === '新请假申请');
    assert.ok(item, '老师应收到「新请假申请」通知');
    assert.match(item.body, /收费同学/);
    notificationId = item.id;
  });

  it('标记单条已读后未读数减少', async () => {
    const r = await api('POST', '/api/notifications/read', teacher, { ids: [notificationId] });
    assert.equal(r.status, 200);
    assert.equal(r.data.unread_count, 0);
    const bad = await api('POST', '/api/notifications/read', teacher, {});
    assert.equal(bad.status, 400);
  });

  it('老师通过请假会通知学生，考勤记为请假', async () => {
    const approve = await api('PUT', `/api/requests/${requestId}/approve`, teacher, { note: '好好休息' });
    assert.equal(approve.status, 200);

    const n = await api('GET', '/api/notifications', student);
    const item = n.data.notifications.find((x) => x.title === '请假申请已通过');
    assert.ok(item, '学生应收到通过通知');
    assert.match(item.body, /好好休息/);

    const detail = await api('GET', `/api/lessons/${lessonId}`, teacher);
    assert.equal(detail.data.attendance[0]?.status, 'leave');
  });

  it('驳回也会通知学生', async () => {
    const lesson2 = await api('POST', '/api/lessons', teacher, {
      class_id: classId, date: addDays(today(), 5), start_time: '18:30', duration_min: 90,
    });
    const r = await api('POST', '/api/requests', student, { kind: 'leave', lesson_id: lesson2.data.lessons[0].id, reason: '想出去玩' });
    const reject = await api('PUT', `/api/requests/${r.data.request.id}/reject`, teacher, { note: '马上要考试了' });
    assert.equal(reject.status, 200);
    const n = await api('GET', '/api/notifications', student);
    assert.ok(n.data.notifications.find((x) => x.title === '请假申请被驳回'));
  });

  it('全部标记已读', async () => {
    const before = await api('GET', '/api/notifications', student);
    assert.ok(before.data.unread_count >= 2);
    const r = await api('POST', '/api/notifications/read', student, { all: true });
    assert.equal(r.data.unread_count, 0);
  });

  it('手动登记的学生（无账号）不会产生通知也不报错', async () => {
    await api('POST', `/api/classes/${classId}/students`, teacher, { name: '无账号同学' });
    const n = await api('GET', '/api/notifications', teacher);
    assert.equal(n.status, 200); // 不因通知失败而报错
  });

  it('按学生收费统计：出勤计费、请假缺勤不计费', async () => {
    // 收费同学请假 1 节（lessonId 已 done 且记 leave）；再加一个手动学生无考勤
    const b = await api('GET', `/api/classes/${classId}/billing?from=${addDays(today(), -1)}&to=${addDays(today(), 6)}`, teacher);
    assert.equal(b.status, 200);
    assert.equal(b.data.class.rate, 150);
    assert.ok(b.data.lesson_count >= 2);

    const billed = b.data.stats.find((s) => s.name === '收费同学');
    assert.ok(billed, '统计里应有收费同学');
    assert.equal(billed.attended, 0, '只请了假，没有出勤');
    assert.equal(billed.leave, 1);
    assert.equal(billed.amount, 0);

    const manual = b.data.stats.find((s) => s.name === '无账号同学');
    assert.ok(manual);
    assert.equal(manual.marked, 0);
    assert.equal(manual.amount, 0);
  });

  it('出勤一节后金额 = 出勤数 × 单节费用', async () => {
    const lesson3 = await api('POST', '/api/lessons', teacher, {
      class_id: classId, date: addDays(today(), 6), start_time: '18:30', duration_min: 90,
    });
    await api('PUT', `/api/lessons/${lesson3.data.lessons[0].id}`, teacher, { status: 'done' });
    const detail = await api('GET', `/api/lessons/${lesson3.data.lessons[0].id}`, teacher);
    const stu = detail.data.students.find((s) => s.name === '收费同学');
    const manual = detail.data.students.find((s) => s.name === '无账号同学');
    await api('PUT', `/api/lessons/${lesson3.data.lessons[0].id}/attendance`, teacher, {
      items: [
        { student_id: stu.id, status: 'present' },
        { student_id: manual.id, status: 'late' },
      ],
    });

    const b = await api('GET', `/api/classes/${classId}/billing?from=${addDays(today(), -1)}&to=${addDays(today(), 7)}`, teacher);
    const billed = b.data.stats.find((s) => s.name === '收费同学');
    assert.equal(billed.attended, 1);
    assert.equal(billed.amount, 150);
    const lateOne = b.data.stats.find((s) => s.name === '无账号同学');
    assert.equal(lateOne.attended, 1, '迟到也算出勤');
    assert.equal(lateOne.amount, 150);
    assert.equal(b.data.total_amount, 300);
  });

  it('结算单 CSV 导出（带 BOM、含金额列）', async () => {
    const res = await fetch(`${base}/api/classes/${classId}/billing/export?from=${addDays(today(), -1)}&to=${addDays(today(), 7)}`, {
      headers: { authorization: `Bearer ${teacher}` },
    });
    assert.equal(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const text = buf.toString('utf8');
    assert.match(text, /应收金额/);
    assert.match(text, /收费同学/);
    assert.match(text, /150/);
    const anon = await fetch(`${base}/api/classes/${classId}/billing/export?from=${today()}&to=${today()}`);
    assert.equal(anon.status, 401);
  });

  it('收费统计参数校验与权限', async () => {
    const badRange = await api('GET', `/api/classes/${classId}/billing?from=${addDays(today(), 5)}&to=${today()}`, teacher);
    assert.equal(badRange.status, 400);
    const deny = await api('GET', `/api/classes/${classId}/billing?from=${today()}&to=${today()}`, student);
    assert.equal(deny.status, 403);
  });

  it('清空通知', async () => {
    const r = await api('DELETE', '/api/notifications', student);
    assert.equal(r.status, 200);
    const n = await api('GET', '/api/notifications', student);
    assert.equal(n.data.notifications.length, 0);
  });
});
