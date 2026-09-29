import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EDUHUB_DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-students';
delete process.env.EDUHUB_LLM_API_KEY;

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
  return { status: res.status, data: await res.json().catch(() => null) };
}

const stamp = Date.now().toString().slice(-6);
let seq = 0;
async function register(role, name) {
  seq += 1;
  const r = await api('POST', '/api/auth/register', null, { name, phone: `136${stamp}${seq}`, password: '123456', role });
  assert.equal(r.status, 201, `注册失败: ${JSON.stringify(r.data)}`);
  return r.data.token;
}

let teacher;
let classId;
let manualId;      // 无账号学生
let accountToken;  // 有账号的学生
let accountId;
let inviteCode;

/** 造一节某状态的课并返回 id */
async function makeLesson(date, time = '18:00', duration = 60, status = 'scheduled') {
  const r = await api('POST', '/api/lessons', teacher, { class_id: classId, date, start_time: time, duration_min: duration });
  const id = r.data.lessons[0].id;
  if (status !== 'scheduled') await api('PUT', `/api/lessons/${id}`, teacher, { status });
  return id;
}

async function mark(id, items) {
  return api('PUT', `/api/lessons/${id}/attendance`, teacher, { items });
}

describe('课时包余额与待补课', () => {
  it('准备：教师、班级、一个无账号学生 + 一个有账号学生', async () => {
    teacher = await register('teacher', '补课班王老师');
    const c = await api('POST', '/api/classes', teacher, { name: '初二数学班' });
    classId = c.data.class.id;
    inviteCode = c.data.class.invite_code;

    const s = await api('POST', `/api/classes/${classId}/students`, teacher, { name: '无账号小明' });
    manualId = s.data.student.id;

    accountToken = await register('student', '有账号小红');
    await api('POST', '/api/classes/join', accountToken, { invite_code: inviteCode });
    const detail = await api('GET', `/api/classes/${classId}`, teacher);
    accountId = detail.data.students.find((x) => x.name === '有账号小红').id;
  });

  it('可以登记购买节数、赠送节数与家长电话', async () => {
    const r = await api('PUT', `/api/classes/${classId}/students/${manualId}`, teacher, {
      lessons_total: 20, lessons_bonus: 2, guardian_phone: '13700000000',
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.student.lessons_total, 20);
    assert.equal(r.data.student.lessons_bonus, 2);
    assert.equal(r.data.student.guardian_phone, '13700000000');
    assert.equal(r.data.credits.remaining, 22, '还没上过课，剩余 = 20 + 2');

    assert.equal((await api('PUT', `/api/classes/${classId}/students/${manualId}`, teacher, { lessons_total: -5 })).status, 400);
    assert.equal((await api('PUT', `/api/classes/${classId}/students/${manualId}`, teacher, { lessons_total: 'abc' })).status, 400);
    assert.equal((await api('PUT', `/api/classes/${classId}/students/${manualId}`, teacher, { name: '  ' })).status, 400);
  });

  it('已消课时：出勤/迟到/缺勤都扣，请假不扣', async () => {
    const l1 = await makeLesson('2026-10-05', '18:00', 60, 'done');
    const l2 = await makeLesson('2026-10-06', '18:00', 60, 'done');
    const l3 = await makeLesson('2026-10-07', '18:00', 60, 'done');
    const l4 = await makeLesson('2026-10-08', '18:00', 60, 'scheduled'); // 未完成，不扣

    await mark(l1, [{ student_id: manualId, status: 'present' }]);
    await mark(l2, [{ student_id: manualId, status: 'late' }]);
    await mark(l3, [{ student_id: manualId, status: 'absent' }]);
    await mark(l4, [{ student_id: manualId, status: 'present' }]);

    const r = await api('GET', `/api/classes/${classId}/credits`, teacher);
    const row = r.data.students.find((x) => x.student_id === manualId);
    assert.equal(row.used, 3, '出勤 + 迟到 + 缺勤');
    assert.equal(row.remaining, 22 - 3);
  });

  it('请假不扣课时，但会记一笔待补课', async () => {
    const l = await makeLesson('2026-10-09', '18:00', 60, 'done');
    await mark(l, [{ student_id: manualId, status: 'leave' }]);

    const credits = await api('GET', `/api/classes/${classId}/credits`, teacher);
    const row = credits.data.students.find((x) => x.student_id === manualId);
    assert.equal(row.used, 3, '请假没有增加已消课时');
    assert.equal(row.owed_makeups, 1, '欠一节补课');

    const mk = await api('GET', `/api/lessons/makeups?class_id=${classId}`, teacher);
    assert.equal(mk.status, 200);
    const mine = mk.data.makeups.filter((m) => m.student_id === manualId);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].status, 'pending');
    assert.equal(mine[0].missed_lesson_id, l);
    assert.equal(mine[0].missed_date, '2026-10-09');
    assert.equal(mine[0].student_name, '无账号小明');
  });

  it('重复保存签到不会重复记账', async () => {
    const mk1 = await api('GET', `/api/lessons/makeups?class_id=${classId}`, teacher);
    const before = mk1.data.makeups.filter((m) => m.student_id === manualId).length;
    const l = mk1.data.makeups.find((m) => m.student_id === manualId).missed_lesson_id;
    await mark(l, [{ student_id: manualId, status: 'leave' }]);
    await mark(l, [{ student_id: manualId, status: 'leave' }]);
    const mk2 = await api('GET', `/api/lessons/makeups?class_id=${classId}`, teacher);
    assert.equal(mk2.data.makeups.filter((m) => m.student_id === manualId).length, before);
  });

  it('改成出勤后欠课自动撤掉', async () => {
    const mk = await api('GET', `/api/lessons/makeups?class_id=${classId}`, teacher);
    const pending = mk.data.makeups.find((m) => m.student_id === manualId && m.status === 'pending');
    await mark(pending.missed_lesson_id, [{ student_id: manualId, status: 'present' }]);
    const after = await api('GET', `/api/lessons/makeups?class_id=${classId}`, teacher);
    assert.equal(after.data.makeups.filter((m) => m.student_id === manualId).length, 0);
    // 出勤要扣课时
    const credits = await api('GET', `/api/classes/${classId}/credits`, teacher);
    assert.equal(credits.data.students.find((x) => x.student_id === manualId).used, 4);
  });

  it('销账：标记已补课后会带上补课的那节课', async () => {
    const missed = await makeLesson('2026-10-12', '18:00', 60, 'done');
    const makeupLesson = await makeLesson('2026-10-14', '18:00', 60, 'done');
    await mark(missed, [{ student_id: manualId, status: 'leave' }]);

    const mk = await api('GET', `/api/lessons/makeups?class_id=${classId}&status=pending`, teacher);
    const row = mk.data.makeups.find((m) => m.missed_lesson_id === missed);
    assert.ok(row);

    const done = await api('PUT', `/api/lessons/makeups/${row.id}`, teacher, {
      status: 'done', makeup_lesson_id: makeupLesson, note: '周四补上了',
    });
    assert.equal(done.status, 200);
    assert.equal(done.data.makeup.status, 'done');
    assert.equal(done.data.makeup.makeup_date, '2026-10-14');
    assert.equal(done.data.makeup.note, '周四补上了');

    // 免补
    const waived = await api('PUT', `/api/lessons/makeups/${row.id}`, teacher, { status: 'waived' });
    assert.equal(waived.data.makeup.status, 'waived');
    assert.equal((await api('PUT', `/api/lessons/makeups/${row.id}`, teacher, { status: '瞎写' })).status, 400);
    assert.equal((await api('PUT', '/api/lessons/makeups/999999', teacher, { status: 'done' })).status, 404);
  });

  it('整班停课时，挂在这些课上的欠课一并撤掉', async () => {
    const d = '2026-10-20';
    const l = await makeLesson(d, '18:00', 60, 'done');
    await mark(l, [{ student_id: manualId, status: 'leave' }]);
    let mk = await api('GET', `/api/lessons/makeups?class_id=${classId}&status=pending`, teacher);
    assert.ok(mk.data.makeups.some((m) => m.missed_lesson_id === l), '先确认欠课已记上');

    await api('PUT', `/api/lessons/${l}`, teacher, { status: 'canceled' });
    mk = await api('GET', `/api/lessons/makeups?class_id=${classId}&status=pending`, teacher);
    assert.ok(!mk.data.makeups.some((m) => m.missed_lesson_id === l), '课都不上了，欠课不该还挂着');
  });

  it('学生也能在自己的班级详情里看到余额与欠课', async () => {
    await api('PUT', `/api/classes/${classId}/students/${accountId}`, teacher, { lessons_total: 10, lessons_bonus: 0 });
    const l = await makeLesson('2026-10-22', '18:00', 60, 'done');
    await mark(l, [{ student_id: accountId, status: 'leave' }]);

    const detail = await api('GET', `/api/classes/${classId}`, accountToken);
    assert.equal(detail.status, 200);
    const me = detail.data.students.find((s) => s.id === accountId);
    assert.equal(me.credits.lessons_total, 10);
    assert.equal(me.owed_makeups, 1);
  });

  it('余额不足会被标出来', async () => {
    await api('PUT', `/api/classes/${classId}/students/${accountId}`, teacher, { lessons_total: 1, lessons_bonus: 0 });
    const credits = await api('GET', `/api/classes/${classId}/credits`, teacher);
    const row = credits.data.students.find((x) => x.student_id === accountId);
    assert.equal(row.used, 0, '请假不扣，所以还没消课时');
    assert.equal(row.remaining, 1);

    const l = await makeLesson('2026-10-23', '18:00', 60, 'done');
    await mark(l, [{ student_id: accountId, status: 'present' }]);
    const after = await api('GET', `/api/classes/${classId}/credits`, teacher);
    const row2 = after.data.students.find((x) => x.student_id === accountId);
    assert.equal(row2.remaining, 0);
    assert.equal(row2.owed, true, '剩余为 0 要标成已欠费');
    assert.equal(after.data.low_credit_count >= 1, true);
  });

  it('其他老师看不到这个班的课时账', async () => {
    const other = await register('teacher', '别的老师');
    assert.equal((await api('GET', `/api/classes/${classId}/credits`, other)).status, 403);
    assert.equal((await api('GET', `/api/lessons/makeups?class_id=${classId}`, other)).status, 403);
  });
});

describe('调课通知与批量调课', () => {
  let classB;

  it('准备第二个班', async () => {
    const b = await api('POST', '/api/classes', teacher, { name: '初二数学 B 班' });
    classB = b.data.class.id;
  });

  it('调课会给学生发通知', async () => {
    // 有账号的小红在这个班
    await api('POST', `/api/classes/${classB}/students`, teacher, { name: '占位' });
    await api('POST', '/api/classes/join', accountToken, { invite_code: (await api('GET', `/api/classes/${classB}`, teacher)).data.class.invite_code });

    const l = await makeLesson('2026-11-02', '18:00', 60);
    // 搬到 B 班之外不影响；直接改这节 A 班课
    const r = await api('POST', `/api/lessons/${l}/reschedule`, teacher, { date: '2026-11-03', start_time: '19:00', duration_min: 60 });
    assert.equal(r.status, 200);

    const notes = await api('GET', '/api/notifications', accountToken);
    const hit = notes.data.notifications.find((n) => n.title.includes('调课'));
    assert.ok(hit, `学生应收到调课通知，实际: ${notes.data.notifications.map((n) => n.title).join(' / ')}`);
    assert.match(hit.body, /2026-11-02 18:00-19:00 → 2026-11-03 19:00-20:00/);
  });

  it('停课与恢复也会通知', async () => {
    const l = await makeLesson('2026-11-05', '18:00', 60);
    await api('PUT', `/api/lessons/${l}`, teacher, { status: 'canceled' });
    let notes = await api('GET', '/api/notifications', accountToken);
    assert.ok(notes.data.notifications.some((n) => n.title.includes('取消')));

    await api('PUT', `/api/lessons/${l}`, teacher, { status: 'scheduled' });
    notes = await api('GET', '/api/notifications', accountToken);
    assert.ok(notes.data.notifications.some((n) => n.title.includes('恢复')));
  });

  it('批量顺延：区间内的课互相不算冲突（这是最容易写错的地方）', async () => {
    // 连续两天各一节，整体顺延 1 天：第二天那节会落到第三天，第三天那节会落到第四天，
    // 如果没把「正在挪动的课」排除出冲突判定，就会自己跟自己报冲突
    await makeLesson('2026-11-10', '18:00', 60);
    await makeLesson('2026-11-11', '18:00', 60);

    const dry = await api('POST', '/api/lessons/batch-reschedule', teacher, {
      class_id: classId, from: '2026-11-10', to: '2026-11-11', shift_days: 1, dry_run: true,
    });
    assert.equal(dry.status, 200);
    assert.equal(dry.data.summary.total, 2);
    assert.equal(dry.data.summary.conflict, 0, `不该有冲突，实际: ${JSON.stringify(dry.data.plan)}`);

    const applied = await api('POST', '/api/lessons/batch-reschedule', teacher, {
      class_id: classId, from: '2026-11-10', to: '2026-11-11', shift_days: 1, dry_run: false,
    });
    assert.equal(applied.data.updated, 2);

    const list = await api('GET', `/api/lessons?from=2026-11-10&to=2026-11-12&class_id=${classId}`, teacher);
    const dates = list.data.lessons.map((l) => l.date).sort();
    assert.deepEqual(dates, ['2026-11-11', '2026-11-12']);

    // 留痕
    const log = await api('GET', `/api/lessons/changes?class_id=${classId}&limit=5`, teacher);
    assert.ok(log.data.changes.some((c) => c.after.batch === true), '批量调课也要留痕');
  });

  it('批量改时间：整个班统一挪到 19:00', async () => {
    const r = await api('POST', '/api/lessons/batch-reschedule', teacher, {
      class_id: classId, from: '2026-11-11', to: '2026-11-12', start_time: '19:00', dry_run: true,
    });
    assert.equal(r.data.summary.ok, 2);
    const applied = await api('POST', '/api/lessons/batch-reschedule', teacher, {
      class_id: classId, from: '2026-11-11', to: '2026-11-12', start_time: '19:00', dry_run: false,
    });
    assert.equal(applied.data.updated, 2);
    const list = await api('GET', `/api/lessons?from=2026-11-11&to=2026-11-12&class_id=${classId}`, teacher);
    assert.ok(list.data.lessons.every((l) => l.start_time === '19:00'));
  });

  it('批量调课会撞上区间外的课并报出来', async () => {
    await makeLesson('2026-11-17', '18:00', 60);
    await makeLesson('2026-11-24', '18:00', 60); // 区间外，但正好是顺延 7 天后的落点
    const dry = await api('POST', '/api/lessons/batch-reschedule', teacher, {
      class_id: classId, from: '2026-11-17', to: '2026-11-17', shift_days: 7, dry_run: true,
    });
    assert.equal(dry.data.summary.conflict, 1, '应该撞上 11-24 那节课');
    assert.equal(dry.data.plan[0].status, 'conflict');
  });

  it('批量调课的参数校验', async () => {
    const bad = [
      { from: '2026-11-10', to: '2026-11-09' },
      { from: '2026-11-10', to: '2026-11-11' },
      { from: '2026-11-10', to: '2026-11-11', shift_days: 0 },
      { from: '2026-11-10', to: '2026-11-11', shift_days: 1.5 },
      { from: '2026-11-10', to: '2026-11-11', shift_days: 999 },
      { from: '2026-11-10', to: '2026-11-11', start_time: '25:00' },
    ];
    for (const b of bad) {
      const r = await api('POST', '/api/lessons/batch-reschedule', teacher, { class_id: classId, ...b });
      assert.equal(r.status, 400, `应拒绝: ${JSON.stringify(b)}`);
    }
  });

  it('智能协调可以显式忽略最短间隔', async () => {
    await api('PUT', '/api/availability/settings', teacher, { min_gap_min: 60 });
    await api('PUT', '/api/availability', teacher, {
      windows: [{ weekday: 4, start_time: '18:00', end_time: '21:00' }],
    });
    const s = await api('POST', `/api/classes/${classId}/students`, teacher, { name: '间隔测试生' });
    await api('PUT', `/api/availability/student/${s.data.student.id}`, teacher, {
      windows: [{ weekday: 4, start_time: '18:00', end_time: '21:00' }],
    });
    // 2026-11-19 是周四
    await api('POST', '/api/lessons', teacher, { class_id: classId, date: '2026-11-19', start_time: '18:00', duration_min: 60 });

    const normal = await api('GET', `/api/availability/match?class_id=${classId}&duration_min=60&from=2026-11-19&to=2026-11-19`, teacher);
    assert.ok(!normal.data.slots.map((x) => x.start_time).includes('19:00'), '默认要留出 60 分钟间隔');

    const ignored = await api('GET', `/api/availability/match?class_id=${classId}&duration_min=60&from=2026-11-19&to=2026-11-19&ignore_gap=1`, teacher);
    assert.ok(ignored.data.slots.map((x) => x.start_time).includes('19:00'), '显式忽略后应放行');
    await api('PUT', '/api/availability/settings', teacher, { min_gap_min: 0 });
  });
});

// 顶层收尾：所有 describe 跑完再关服务
after(() => server.close());
