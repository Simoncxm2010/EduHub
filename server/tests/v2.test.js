import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EDUHUB_DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-v2';
process.env.EDUHUB_SUPER_PHONE = '13900000009'; // 该手机号注册即为超管

const { createApp } = await import('../src/app.js');
const { today } = await import('../src/db.js');
const { addDays, weekdayOf, fmtDate } = await import('../src/util.js');

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

let teacher, student, otherTeacher, superAdmin, admin;
let classId, inviteCode, lessonId, requestId;

describe('师枢 v0.3 角色、申请、协调与日历', () => {
  after(() => server.close());

  /* ---------------- 角色与权限 ---------------- */

  it('指定手机号注册即成为超级管理员', async () => {
    superAdmin = await reg('张校长', '13900000009', 'teacher');
    assert.equal(superAdmin.status, 201);
    assert.equal(superAdmin.data.user.role, 'super');
    superAdmin = superAdmin.data.token;
  });

  it('超管可以创建管理员账号', async () => {
    const r = await api('POST', '/api/admin/users', superAdmin, { name: '教务李老师', phone: '13900000010', password: '123456', role: 'admin' });
    assert.equal(r.status, 201);
    assert.equal(r.data.user.role, 'admin');
  });

  it('管理员可以登录并查看用户列表', async () => {
    const login = await api('POST', '/api/auth/login', null, { phone: '13900000010', password: '123456' });
    assert.equal(login.status, 200);
    admin = login.data.token;
    const list = await api('GET', '/api/admin/users', admin);
    assert.equal(list.status, 200);
    assert.ok(list.data.users.length >= 2);
  });

  it('普通教师不能访问管理接口', async () => {
    const t = await reg('王老师', '13900000001', 'teacher');
    teacher = t.data.token;
    const r = await api('GET', '/api/admin/users', teacher);
    assert.equal(r.status, 403);
    const s = await api('GET', '/api/admin/stats', teacher);
    assert.equal(s.status, 403);
  });

  it('管理员不能把别人提升为管理员，超管可以', async () => {
    const target = await reg('赵老师', '13900000002', 'teacher');
    const targetId = (await api('GET', '/api/auth/me', target.data.token)).data.user.id;
    otherTeacher = target.data.token;

    const denied = await api('PUT', `/api/admin/users/${targetId}/role`, admin, { role: 'admin' });
    assert.equal(denied.status, 403);

    const ok = await api('PUT', `/api/admin/users/${targetId}/role`, superAdmin, { role: 'admin' });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.user.role, 'admin');
    // 改回去，后面用他当普通教师
    await api('PUT', `/api/admin/users/${targetId}/role`, superAdmin, { role: 'teacher' });
  });

  it('停用账号后无法登录，且已签发的令牌立即失效', async () => {
    const victim = await reg('待停用老师', '13900000003', 'teacher');
    const victimId = (await api('GET', '/api/auth/me', victim.data.token)).data.user.id;
    assert.equal((await api('GET', '/api/classes', victim.data.token)).status, 200);

    const off = await api('PUT', `/api/admin/users/${victimId}/status`, admin, { status: 'disabled' });
    assert.equal(off.status, 200);
    assert.equal(off.data.user.status, 'disabled');

    const login = await api('POST', '/api/auth/login', null, { phone: '13900000003', password: '123456' });
    assert.equal(login.status, 403);

    const reuse = await api('GET', '/api/classes', victim.data.token);
    assert.equal(reuse.status, 403, '停用后旧令牌应立即失效');

    await api('PUT', `/api/admin/users/${victimId}/status`, admin, { status: 'active' });
    assert.equal((await api('POST', '/api/auth/login', null, { phone: '13900000003', password: '123456' })).status, 200);
  });

  it('不能停用自己的账号', async () => {
    const me = (await api('GET', '/api/auth/me', admin)).data.user.id;
    const r = await api('PUT', `/api/admin/users/${me}/status`, admin, { status: 'disabled' });
    assert.equal(r.status, 400);
  });

  it('管理员可以重置密码', async () => {
    const u = await reg('忘记密码的同学', '13900000004', 'student');
    const id = (await api('GET', '/api/auth/me', u.data.token)).data.user.id;
    const r = await api('PUT', `/api/admin/users/${id}/password`, admin, { password: 'newpass123' });
    assert.equal(r.status, 200);
    assert.equal((await api('POST', '/api/auth/login', null, { phone: '13900000004', password: 'newpass123' })).status, 200);
    const weak = await api('PUT', `/api/admin/users/${id}/password`, admin, { password: '123' });
    assert.equal(weak.status, 400);
  });

  it('管理员可见全部班级', async () => {
    const cls = await api('POST', '/api/classes', teacher, { name: '高二英语班', subject: '英语' });
    classId = cls.data.class.id;
    inviteCode = cls.data.class.invite_code;
    const list = await api('GET', '/api/classes', admin);
    assert.equal(list.status, 200);
    assert.ok(list.data.classes.some((c) => c.id === classId));
    // 其它教师看不到别人的班
    const other = await api('GET', '/api/classes', otherTeacher);
    assert.ok(!other.data.classes.some((c) => c.id === classId));
  });

  it('管理后台概览统计', async () => {
    const r = await api('GET', '/api/admin/stats', admin);
    assert.equal(r.status, 200);
    assert.ok(r.data.total_users >= 5);
    assert.equal(r.data.classes, 1);
    assert.ok(r.data.roles.super >= 1);
    assert.ok(r.data.roles.admin >= 1);
  });

  /* ---------------- 请假与预约 ---------------- */

  it('学生加入班级并有一节课', async () => {
    const s = await reg('同学小美', '13900000005', 'student');
    student = s.data.token;
    const join = await api('POST', '/api/classes/join', student, { invite_code: inviteCode });
    assert.equal(join.status, 201);
    const lesson = await api('POST', '/api/lessons', teacher, {
      class_id: classId, date: addDays(today(), 3), start_time: '18:30', duration_min: 90, room: '201',
    });
    lessonId = lesson.data.lessons[0].id;
  });

  it('学生请假 → 教师通过 → 自动记为请假', async () => {
    const r = await api('POST', '/api/requests', student, { kind: 'leave', lesson_id: lessonId, reason: '感冒发烧' });
    assert.equal(r.status, 201);
    assert.equal(r.data.request.kind, 'leave');
    assert.equal(r.data.request.status, 'pending');
    requestId = r.data.request.id;

    const dup = await api('POST', '/api/requests', student, { kind: 'leave', lesson_id: lessonId, reason: '再请一次' });
    assert.equal(dup.status, 400);

    const list = await api('GET', '/api/requests?status=pending', teacher);
    assert.equal(list.data.pending_count, 1);

    const approve = await api('PUT', `/api/requests/${requestId}/approve`, teacher, { note: '注意休息' });
    assert.equal(approve.status, 200);
    assert.equal(approve.data.request.status, 'approved');

    const detail = await api('GET', `/api/lessons/${lessonId}`, teacher);
    const mine = detail.data.attendance.find((a) => a.status === 'leave');
    assert.ok(mine, '通过请假后该生应记为请假');
  });

  it('已处理的申请不能重复审批', async () => {
    const again = await api('PUT', `/api/requests/${requestId}/approve`, teacher);
    assert.equal(again.status, 400);
  });

  it('学生只能撤销自己待处理的申请', async () => {
    const lesson2 = await api('POST', '/api/lessons', teacher, {
      class_id: classId, date: addDays(today(), 10), start_time: '18:30', duration_min: 90,
    });
    const r = await api('POST', '/api/requests', student, { kind: 'leave', lesson_id: lesson2.data.lessons[0].id, reason: '有事' });
    const id = r.data.request.id;
    const other = await api('DELETE', `/api/requests/${id}`, otherTeacher);
    assert.equal(other.status, 403);
    const own = await api('DELETE', `/api/requests/${id}`, student);
    assert.equal(own.status, 200);
    assert.equal(own.data.request.status, 'canceled');
  });

  it('学生预约课程 → 教师通过 → 生成课时', async () => {
    const r = await api('POST', '/api/requests', student, {
      kind: 'booking', class_id: classId, date: addDays(today(), 20), start_time: '19:00', duration_min: 60, room: '201', reason: '想补一节课',
    });
    assert.equal(r.status, 201);
    const approve = await api('PUT', `/api/requests/${r.data.request.id}/approve`, teacher);
    assert.equal(approve.status, 200);
    assert.ok(approve.data.lesson_id, '通过预约应生成课时');

    const lesson = await api('GET', `/api/lessons/${approve.data.lesson_id}`, teacher);
    assert.equal(lesson.data.lesson.date, addDays(today(), 20));
    assert.equal(lesson.data.lesson.start_time, '19:00');
    assert.match(lesson.data.lesson.topic, /预约/);
  });

  it('预约时段冲突时审批被拒绝并说明原因', async () => {
    const date = addDays(today(), 25);
    await api('POST', '/api/lessons', teacher, { class_id: classId, date, start_time: '19:00', duration_min: 60 });
    const r = await api('POST', '/api/requests', student, {
      kind: 'booking', class_id: classId, date, start_time: '19:30', duration_min: 60,
    });
    // 提交时就会带上冲突提示，但仍然允许提交（老师可改期）
    assert.ok(r.data.conflict_note, '提交预约时应返回冲突提示');
    const approve = await api('PUT', `/api/requests/${r.data.request.id}/approve`, teacher);
    assert.equal(approve.status, 409);
  });

  it('不能预约过去的日期', async () => {
    const r = await api('POST', '/api/requests', student, {
      kind: 'booking', class_id: classId, date: addDays(today(), -1), start_time: '19:00',
    });
    assert.equal(r.status, 400);
  });

  it('教师不能替学生提交申请', async () => {
    const r = await api('POST', '/api/requests', teacher, { kind: 'leave', lesson_id: lessonId });
    assert.equal(r.status, 403);
  });

  it('学生申请汇总', async () => {
    const r = await api('GET', '/api/requests/my-summary', student);
    assert.equal(r.status, 200);
    assert.ok(r.data.summary.leave_approved >= 1);
    assert.ok(r.data.summary.booking_approved >= 1);
  });

  /* ---------------- 可上课时段与智能协调 ---------------- */

  it('保存并覆盖可上课时段', async () => {
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      const r = await api('PUT', '/api/availability', student, { windows: [{ weekday: day, start_time: '18:00', end_time: '21:00' }] });
      assert.equal(r.status, 200);
    }
    const list = await api('GET', '/api/availability', student);
    assert.equal(list.data.windows.length, 1, '覆盖式保存应只留最后一次');
    assert.equal(list.data.windows[0].start_time, '18:00');
  });

  it('时段校验：开始必须早于结束', async () => {
    const r = await api('PUT', '/api/availability', student, { windows: [{ weekday: 1, start_time: '20:00', end_time: '19:00' }] });
    assert.equal(r.status, 400);
    const bad = await api('PUT', '/api/availability', student, { windows: [{ weekday: 9, start_time: '18:00', end_time: '19:00' }] });
    assert.equal(bad.status, 400);
    // 恢复成整周 18:00-21:00
    await api('PUT', '/api/availability', student, {
      windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start_time: '18:00', end_time: '21:00' })),
    });
  });

  it('教师设置可授课时段后可看到学生的时段', async () => {
    const r = await api('PUT', '/api/availability', teacher, {
      windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start_time: '18:00', end_time: '21:00' })),
    });
    assert.equal(r.status, 200);
    const view = await api('GET', `/api/availability/class/${classId}`, teacher);
    assert.equal(view.status, 200);
    assert.equal(view.data.students[0].windows.length, 7);
    // 学生不能看别人的时段
    const deny = await api('GET', '/api/availability?user_id=1', student);
    assert.equal(deny.status, 403);
  });

  it('智能协调时间：找出双方都有空的时段并统计人数', async () => {
    // 选一段没有排课的日期，结果可以精确预测
    const from = addDays(today(), 100);
    const to = addDays(from, 6);
    const r = await api('GET', `/api/availability/match?class_id=${classId}&duration_min=60&from=${from}&to=${to}`, teacher);
    assert.equal(r.status, 200);
    // 每天 18:00-21:00 内、60 分钟、每 30 分钟一个候选 -> 5 个/天 × 7 天
    assert.equal(r.data.total_slots, 35);
    assert.equal(r.data.students_with_windows, 1);
    assert.equal(r.data.slots[0].free_count, 1);
    assert.equal(r.data.slots[0].total_students, 1);
    assert.equal(r.data.slots[0].start_time, '18:00');
    assert.equal(r.data.slots[0].end_time, '19:00');
  });

  it('已有排课的时段会被智能协调排除', async () => {
    const date = addDays(today(), 101);
    await api('POST', '/api/lessons', teacher, { class_id: classId, date, start_time: '19:00', duration_min: 60, room: '201' });
    const r = await api('GET', `/api/availability/match?class_id=${classId}&duration_min=60&from=${date}&to=${date}`, teacher);
    // 19:00-20:00 的课会挡住 18:30 / 19:00 / 19:30 三个候选，只剩 18:00 与 20:00
    assert.equal(r.data.total_slots, 2);
    const starts = r.data.slots.map((s) => s.start_time);
    assert.deepEqual(starts.sort(), ['18:00', '20:00']);
  });

  it('学生视角的智能协调只返回自己有空且老师有空的时段', async () => {
    const r = await api('GET', `/api/availability/match?class_id=${classId}&duration_min=60&from=${today()}&to=${addDays(today(), 2)}`, student);
    assert.equal(r.status, 200);
    assert.equal(r.data.scope, 'me');
    assert.ok(r.data.slots.length >= 1);
  });

  /* ---------------- 日历订阅与导入导出 ---------------- */

  it('导出 .ics 文件', async () => {
    const res = await fetch(`${base}/api/calendar/export.ics?class_id=${classId}`, {
      headers: { authorization: `Bearer ${teacher}` },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/calendar/);
    const text = await res.text();
    assert.match(text, /BEGIN:VCALENDAR/);
    assert.match(text, /BEGIN:VEVENT/);
    assert.match(text, /SUMMARY:高二英语班/);
    assert.match(text, /BEGIN:VALARM/);
    assert.match(text, /TRIGGER:-PT30M/);
    assert.match(text, /END:VCALENDAR/);
    assert.ok(text.includes('\r\n'), 'ICS 必须使用 CRLF');
  });

  it('订阅地址无需登录即可读取，重置后旧地址失效', async () => {
    const info = await api('GET', '/api/calendar/feed-url', teacher);
    assert.equal(info.status, 200);
    assert.match(info.data.webcal, /^webcal:\/\//);

    const anon = await fetch(`${base}/api/calendar/feed.ics?token=${info.data.token}`);
    assert.equal(anon.status, 200);
    assert.match(await anon.text(), /BEGIN:VCALENDAR/);

    const bad = await fetch(`${base}/api/calendar/feed.ics?token=nope`);
    assert.equal(bad.status, 401);

    const reset = await api('POST', '/api/calendar/feed-token/reset', teacher);
    assert.equal(reset.status, 200);
    assert.notEqual(reset.data.token, info.data.token);
    assert.equal((await fetch(`${base}/api/calendar/feed.ics?token=${info.data.token}`)).status, 401);
  });

  it('导入 .ics：先预览，冲突日期标出，再落库', async () => {
    const d1 = addDays(today(), 40);
    const d2 = addDays(today(), 41);
    const d3 = addDays(today(), 42);
    // d3 与已有课时冲突
    await api('POST', '/api/lessons', teacher, { class_id: classId, date: d3, start_time: '19:00', duration_min: 60 });
    const compact = (d) => d.replace(/-/g, '');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//CN',
      'BEGIN:VEVENT', 'UID:a@test', `DTSTART:${compact(d1)}T183000`, `DTEND:${compact(d1)}T200000`, 'SUMMARY:三角函数专题', 'LOCATION:305', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:b@test', `DTSTART:${compact(d2)}T090000`, `DTEND:${compact(d2)}T103000`, 'SUMMARY:期中复习', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:c@test', `DTSTART:${compact(d3)}T193000`, `DTEND:${compact(d3)}T203000`, 'SUMMARY:与已有课冲突', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const preview = await api('POST', '/api/calendar/import.ics', teacher, { class_id: classId, text: ics });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.summary.total, 3);
    assert.equal(preview.data.summary.ok, 2);
    assert.equal(preview.data.summary.conflict, 1);
    assert.equal(preview.data.plan[0].duration_min, 90);
    assert.equal(preview.data.plan[0].room, '305');

    // 预览不写库
    const before = await api('GET', `/api/lessons?from=${d1}&to=${d2}&class_id=${classId}`, teacher);
    assert.equal(before.data.lessons.length, 0);

    const created = await api('POST', '/api/calendar/import.ics', teacher, { class_id: classId, text: ics, dry_run: false });
    assert.equal(created.status, 201);
    assert.equal(created.data.created.length, 2);
    assert.equal(created.data.skipped.length, 1);
    const first = created.data.created.find((l) => l.date === d1);
    assert.equal(first.topic, '三角函数专题');
    assert.equal(first.start_time, '18:30');
  });

  it('拒绝无效的日历内容', async () => {
    const r = await api('POST', '/api/calendar/import.ics', teacher, { class_id: classId, text: 'hello world' });
    assert.equal(r.status, 400);
  });

  /* ---------------- 批量操作与导出安全 ---------------- */

  it('批量把一段时间设为停课，再恢复', async () => {
    const from = addDays(today(), 60);
    const to = addDays(today(), 62);
    for (const d of [from, to]) {
      await api('POST', '/api/lessons', teacher, { class_id: classId, date: d, start_time: '19:00', duration_min: 60 });
    }
    const cancel = await api('POST', '/api/lessons/bulk-status', teacher, { class_id: classId, from, to, status: 'canceled' });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.data.updated, 2);

    const resume = await api('POST', '/api/lessons/bulk-status', teacher, { class_id: classId, from, to, status: 'scheduled' });
    assert.equal(resume.data.updated, 2);
    const bad = await api('POST', '/api/lessons/bulk-status', teacher, { class_id: classId, from, to, status: 'done' });
    assert.equal(bad.status, 400);
  });

  it('CSV 导出会中和公式注入', async () => {
    const date = addDays(today(), 70);
    const lesson = await api('POST', '/api/lessons', teacher, {
      class_id: classId, date, start_time: '19:00', duration_min: 60, topic: '=cmd|calc!A1',
    });
    await api('PUT', `/api/lessons/${lesson.data.lessons[0].id}/record`, teacher, { content: '@SUM(1+1)' });

    const res = await fetch(`${base}/api/lessons/export/csv?class_id=${classId}`, {
      headers: { authorization: `Bearer ${teacher}` },
    });
    const text = Buffer.from(await res.arrayBuffer()).toString('utf8');
    assert.ok(text.includes(`"'=cmd|calc!A1"`), '以 = 开头的内容应加单引号前缀');
    assert.ok(text.includes(`"'@SUM(1+1)"`), '以 @ 开头的内容应加单引号前缀');
    assert.ok(!/,"=cmd/.test(text), '不能出现未转义的公式单元格');
  });

  it('教师课酬统计（本月已完成课时 × 单节费用）', async () => {
    await api('PUT', `/api/classes/${classId}`, teacher, { rate: 200 });
    const cls = await api('GET', `/api/classes/${classId}`, teacher);
    assert.equal(cls.data.class.rate, 200);
    const list = await api('GET', `/api/lessons?from=${today()}&to=${today()}&class_id=${classId}`, teacher);
    if (list.data.lessons.length) {
      await api('PUT', `/api/lessons/${list.data.lessons[0].id}`, teacher, { status: 'done' });
    }
    const dash = await api('GET', '/api/lessons/dashboard/overview', teacher);
    assert.equal(dash.status, 200);
    assert.equal(typeof dash.data.stats.month_income, 'number');
    if (list.data.lessons.length) assert.equal(dash.data.stats.month_income, 200);
  });
});
