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

  /* ---------- 拍照 / 手写签名留痕 ---------- */

  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  let photoUrl, signatureUrl;

  it('未登录不能上传图片', async () => {
    const r = await api('POST', '/api/uploads', null, { data: PNG, kind: 'photo' });
    assert.equal(r.status, 401);
  });

  it('上传课堂照片返回可访问地址', async () => {
    const r = await api('POST', '/api/uploads', teacherToken, { data: PNG, kind: 'photo' });
    assert.equal(r.status, 201);
    assert.match(r.data.url, /^\/uploads\/[\w.-]+\.png$/);
    photoUrl = r.data.url;
  });

  it('上传签名图片', async () => {
    const r = await api('POST', '/api/uploads', teacherToken, { data: PNG, kind: 'signature' });
    assert.equal(r.status, 201);
    signatureUrl = r.data.url;
  });

  it('拒绝非法图片数据', async () => {
    const bad = await api('POST', '/api/uploads', teacherToken, { data: 'not-an-image', kind: 'photo' });
    assert.equal(bad.status, 400);
    const evil = await api('POST', '/api/uploads', teacherToken, { data: 'https://evil.test/a.png', kind: 'photo' });
    assert.equal(evil.status, 400);
  });

  it('教师保存课堂留痕（照片 + 教师签名）', async () => {
    const r = await api('PUT', `/api/lessons/${lessonId}/checkin`, teacherToken, {
      checkin_photo: photoUrl,
      teacher_signature: signatureUrl,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.lesson.checkin_photo, photoUrl);
    assert.equal(r.data.lesson.teacher_signature, signatureUrl);
    assert.ok(r.data.lesson.checkin_at);
  });

  it('留痕接口拒绝外部图片地址', async () => {
    const r = await api('PUT', `/api/lessons/${lessonId}/checkin`, teacherToken, { checkin_photo: 'http://x.test/a.jpg' });
    assert.equal(r.status, 400);
  });

  it('学生不能修改课堂留痕', async () => {
    const r = await api('PUT', `/api/lessons/${lessonId}/checkin`, studentToken, { checkin_photo: photoUrl });
    assert.equal(r.status, 403);
  });

  it('教师按名单保存学生签名', async () => {
    const detail = await api('GET', `/api/lessons/${lessonId}`, teacherToken);
    const items = detail.data.students.map((s, i) => ({
      student_id: s.id,
      status: i === 0 ? 'present' : 'absent',
      signature: i === 0 ? signatureUrl : null,
    }));
    const r = await api('PUT', `/api/lessons/${lessonId}/attendance`, teacherToken, { items });
    assert.equal(r.status, 200);
    const signed = r.data.attendance.find((a) => a.status === 'present');
    assert.equal(signed.signature, signatureUrl);
    assert.ok(signed.signed_at);
  });

  it('局部提交签到不会清掉已保存的签名', async () => {
    const detail = await api('GET', `/api/lessons/${lessonId}`, teacherToken);
    // 只提交状态，不带 signature 字段
    const r = await api('PUT', `/api/lessons/${lessonId}/attendance`, teacherToken, {
      items: detail.data.students.map((s) => ({ student_id: s.id, status: 'present' })),
    });
    assert.equal(r.status, 200);
    const kept = r.data.attendance.filter((a) => a.signature);
    assert.equal(kept.length, 1);
  });

  it('学生自助签到必须带签名', async () => {
    const noSig = await api('PUT', `/api/lessons/${lessonId}/attendance/me`, studentToken, { status: 'present' });
    assert.equal(noSig.status, 400);
    const badStatus = await api('PUT', `/api/lessons/${lessonId}/attendance/me`, studentToken, {
      status: 'absent', signature: signatureUrl,
    });
    assert.equal(badStatus.status, 400);
  });

  it('学生自助拍照 + 签名签到成功', async () => {
    const r = await api('PUT', `/api/lessons/${lessonId}/attendance/me`, studentToken, {
      status: 'present', signature: signatureUrl, photo: photoUrl,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.attendance.status, 'present');
    assert.equal(r.data.attendance.signature, signatureUrl);
    assert.ok(r.data.attendance.signed_at);
  });

  it('学生只看到自己的签名，同学的仅显示是否已签', async () => {
    const r = await api('GET', `/api/lessons/${lessonId}`, studentToken);
    assert.equal(r.status, 200);
    const mine = r.data.attendance.filter((a) => a.signature);
    assert.equal(mine.length, 1);
    for (const a of r.data.attendance) {
      if (!a.signature) assert.equal(a.photo, undefined);
      assert.equal(typeof a.signed, 'boolean');
    }
  });

  it('教师能看到全部学生的签名与照片', async () => {
    const r = await api('GET', `/api/lessons/${lessonId}`, teacherToken);
    const withSig = r.data.attendance.filter((a) => a.signature);
    assert.ok(withSig.length >= 1);
    assert.equal(withSig.some((a) => a.photo), true);
  });

  it('课时列表带留痕标记', async () => {
    const r = await api('GET', `/api/lessons?from=${today()}&to=${addDays(today(), 1)}`, teacherToken);
    const lesson = r.data.lessons.find((l) => l.id === lessonId);
    assert.equal(lesson.has_checkin, 1);
    assert.ok(lesson.signed_count >= 1);
  });

  /* ---------- 图片鉴权 ---------- */

  it('未登录不能读取照片与签名', async () => {
    const anon = await fetch(base + photoUrl);
    assert.equal(anon.status, 401);
    const withToken = await fetch(base + photoUrl, { headers: { authorization: `Bearer ${teacherToken}` } });
    assert.equal(withToken.status, 200);
    assert.equal(withToken.headers.get('content-type'), 'image/png');
  });

  it('登录下发 httpOnly Cookie，图片可凭 Cookie 读取，退出后清除', async () => {
    const res = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '13900000001', password: '123456' }),
    });
    const setCookie = res.headers.get('set-cookie') || '';
    assert.match(setCookie, /eduhub_token=/);
    assert.match(setCookie, /HttpOnly/i);
    const cookie = setCookie.split(';')[0];

    const img = await fetch(base + photoUrl, { headers: { cookie } });
    assert.equal(img.status, 200);

    const out = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { cookie } });
    assert.equal(out.status, 200);
    assert.match(out.headers.get('set-cookie') || '', /eduhub_token=;/);
  });

  /* ---------- 智能排课 ---------- */

  const DOW = new Date(`${today()}T00:00:00`).getDay();

  it('排课冲突预检识别同班级重叠', async () => {
    // 该课时为 today() 18:30 起 90 分钟
    const hit = await api('GET', `/api/lessons/check?class_id=${classId}&date=${today()}&start_time=19:00&duration_min=60`, teacherToken);
    assert.equal(hit.status, 200);
    assert.equal(hit.data.conflicts.length, 1);
    assert.equal(hit.data.conflicts[0].type, 'class');

    const free = await api('GET', `/api/lessons/check?class_id=${classId}&date=${addDays(today(), 3)}&start_time=19:00&duration_min=60`, teacherToken);
    assert.equal(free.data.conflicts.length, 0);
  });

  it('智能排课预览：跳过冲突日期且不写库', async () => {
    // skip_holidays=false：这条用例只关心冲突判定，避免日期范围恰好压到法定假日时结果随「今天」漂移
    const body = {
      class_id: classId, weekdays: [DOW], start_time: '18:30', duration_min: 90,
      from: today(), to: addDays(today(), 21), dry_run: true, skip_holidays: false,
    };
    const before = await api('GET', `/api/lessons?from=${today()}&to=${addDays(today(), 21)}&class_id=${classId}`, teacherToken);
    const r = await api('POST', '/api/lessons/smart/plan', teacherToken, body);
    assert.equal(r.status, 200);
    assert.equal(r.data.summary.total, 4); // today / +7 / +14 / +21
    assert.equal(r.data.summary.conflict, 2); // today 与 +7 已排过 18:30
    assert.equal(r.data.summary.ok, 2);
    assert.equal(r.data.plan[0].status, 'conflict');

    const after = await api('GET', `/api/lessons?from=${today()}&to=${addDays(today(), 21)}&class_id=${classId}`, teacherToken);
    assert.equal(after.data.lessons.length, before.data.lessons.length, 'dry_run 不应写库');
  });

  it('智能排课执行：只创建不冲突的课时', async () => {
    const r = await api('POST', '/api/lessons/smart/plan', teacherToken, {
      class_id: classId, weekdays: [DOW], start_time: '18:30', duration_min: 90,
      from: today(), to: addDays(today(), 21), dry_run: false, skip_holidays: false,
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.created.length, 2);
    assert.equal(r.data.skipped.length, 2);
    for (const l of r.data.created) assert.equal(l.status, 'scheduled');
  });

  it('智能排课支持手动排除日期', async () => {
    const r = await api('POST', '/api/lessons/smart/plan', teacherToken, {
      class_id: classId, weekdays: [DOW], start_time: '07:00', duration_min: 60,
      from: addDays(today(), 14), to: addDays(today(), 21),
      skip_dates: [addDays(today(), 14)], dry_run: true, skip_holidays: false,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.summary.skip, 1);
    assert.equal(r.data.summary.ok, 1);
    assert.equal(r.data.plan[0].reason, '已手动排除');
  });

  it('智能排课参数校验', async () => {
    const noDay = await api('POST', '/api/lessons/smart/plan', teacherToken, {
      class_id: classId, weekdays: [], start_time: '18:30', from: today(), to: addDays(today(), 7),
    });
    assert.equal(noDay.status, 400);
    const badRange = await api('POST', '/api/lessons/smart/plan', teacherToken, {
      class_id: classId, weekdays: [DOW], start_time: '18:30', from: addDays(today(), 7), to: today(),
    });
    assert.equal(badRange.status, 400);
    const student = await api('POST', '/api/lessons/smart/plan', studentToken, {
      class_id: classId, weekdays: [DOW], start_time: '18:30', from: today(), to: addDays(today(), 7),
    });
    assert.equal(student.status, 403);
  });

  it('智能排课建议识别该班常用时段', async () => {
    const r = await api('GET', `/api/lessons/smart/suggest?class_id=${classId}`, teacherToken);
    assert.equal(r.status, 200);
    assert.ok(r.data.suggestion);
    assert.equal(r.data.suggestion.start_time, '18:30');
    assert.equal(r.data.suggestion.duration_min, 90);
    assert.ok(r.data.suggestion.hits >= 2);
  });

  it('复制课时到另一天', async () => {
    const target = addDays(today(), 30);
    const r = await api('POST', `/api/lessons/${lessonId}/duplicate`, teacherToken, { date: target });
    assert.equal(r.status, 201);
    assert.equal(r.data.lesson.date, target);
    assert.equal(r.data.lesson.start_time, '18:30');
    assert.equal(r.data.lesson.duration_min, 90);
    assert.equal(r.data.lesson.status, 'scheduled');
    assert.equal(r.data.lesson.checkin_photo, null, '复制不应带走留痕');
  });

  /* ---------- 出勤统计与导出 ---------- */

  it('班级出勤统计', async () => {
    const r = await api('GET', `/api/classes/${classId}/stats`, teacherToken);
    assert.equal(r.status, 200);
    assert.ok(r.data.total_lessons >= 1);
    assert.equal(r.data.stats.length, 3);
    const marked = r.data.stats.filter((s) => s.marked > 0);
    assert.ok(marked.length >= 1);
    assert.equal(typeof marked[0].rate, 'number');
    assert.ok(marked[0].rate >= 0 && marked[0].rate <= 100);

    const forbid = await api('GET', `/api/classes/${classId}/stats`, studentToken);
    assert.equal(forbid.status, 403);
  });

  it('导出 CSV：表头、BOM 与数据行', async () => {
    const res = await fetch(`${base}/api/lessons/export/csv?class_id=${classId}`, {
      headers: { authorization: `Bearer ${teacherToken}` },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /attachment/);
    const buf = Buffer.from(await res.arrayBuffer());
    // Response.text() 会按规范吞掉 BOM，所以直接查原始字节（EF BB BF）
    assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], '需要 BOM 以便 Excel 识别中文');
    const text = buf.toString('utf8');
    const lines = text.replace(/^\uFEFF/, '').trim().split('\r\n');
    assert.ok(lines.length >= 2);
    assert.match(lines[0], /日期/);
    assert.match(lines[0], /已签名/);

    const anon = await fetch(`${base}/api/lessons/export/csv?class_id=${classId}`);
    assert.equal(anon.status, 401);
  });
});
