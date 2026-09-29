import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EDUHUB_DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-scheduling';
delete process.env.EDUHUB_LLM_API_KEY;

const { createApp } = await import('../src/app.js');
const { normalizeRule, appliesOn, allowsDuration, ruleSummary } = await import('../src/availability-rules.js');
const { isoWeek } = await import('../src/util.js');

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
  const r = await api('POST', '/api/auth/register', null, {
    name, phone: `137${stamp}${seq}`, password: '123456', role,
  });
  assert.equal(r.status, 201, `注册失败: ${JSON.stringify(r.data)}`);
  return r.data.token;
}

/* ==================== 规则（纯函数） ==================== */

describe('可上课时段规则', () => {
  const ok = (o) => { const r = normalizeRule(o); assert.ok(!r.error, `不该报错: ${r.error}`); return r.rule; };
  const base = { weekday: 2, start_time: '18:00', end_time: '21:00' };

  it('指定具体日期时用日期推导星期，忽略传入的 weekday', () => {
    // 2026-01-06 是周二
    const r = ok({ ...base, weekday: 0, specific_date: '2026-01-06' });
    assert.equal(r.weekday, 2);
  });

  it('非法组合被挡下', () => {
    assert.match(normalizeRule({ ...base, valid_from: '2026-03-01', valid_to: '2026-02-01' }).error, /起始日期/);
    assert.match(normalizeRule({ ...base, min_duration: 120, max_duration: 60 }).error, /最短时长/);
    assert.match(normalizeRule({ ...base, min_duration: 5 }).error, /最短时长/);
    assert.match(normalizeRule({ ...base, max_duration: 999 }).error, /最长时长/);
    assert.match(normalizeRule({ ...base, week_parity: 'biweekly' }).error, /单双周/);
    assert.match(normalizeRule({ ...base, specific_date: '2026-13-01' }).error, /具体日期/);
    assert.match(normalizeRule({ ...base, weekday: 9 }).error, /星期/);
  });

  it('生效日期范围（闭区间）', () => {
    const r = ok({ ...base, valid_from: '2026-01-05', valid_to: '2026-01-18' });
    assert.equal(appliesOn(r, '2026-01-04'), false, '范围之前');
    assert.equal(appliesOn(r, '2026-01-06'), true, '范围内');
    assert.equal(appliesOn(r, '2026-01-19'), false, '范围之后');
    // 只给起始或只给结束
    assert.equal(appliesOn(ok({ ...base, valid_from: '2026-01-05' }), '2026-01-06'), true);
    assert.equal(appliesOn(ok({ ...base, valid_to: '2026-01-05' }), '2026-01-06'), false);
  });

  it('单双周按 ISO 周序号判断', () => {
    // 2026-01-01 是周四 => ISO 第 1 周；01-06 落在第 2 周、01-13 落在第 3 周
    assert.equal(isoWeek('2026-01-06'), 2);
    assert.equal(isoWeek('2026-01-13'), 3);
    const odd = ok({ ...base, week_parity: 'odd' });
    const even = ok({ ...base, week_parity: 'even' });
    assert.equal(appliesOn(odd, '2026-01-06'), false);
    assert.equal(appliesOn(odd, '2026-01-13'), true);
    assert.equal(appliesOn(even, '2026-01-06'), true);
    assert.equal(appliesOn(even, '2026-01-13'), false);
  });

  it('具体某天只在那一天生效，即使星期相同', () => {
    const r = ok({ ...base, specific_date: '2026-01-06' });
    assert.equal(appliesOn(r, '2026-01-06'), true);
    assert.equal(appliesOn(r, '2026-01-13'), false);
  });

  it('时长范围：不填就是不限', () => {
    const r = ok({ ...base, min_duration: 60, max_duration: 120 });
    assert.equal(allowsDuration(r, 30), false);
    assert.equal(allowsDuration(r, 90), true);
    assert.equal(allowsDuration(r, 180), false);
    assert.equal(allowsDuration(ok(base), 300), true);
  });

  it('规则摘要能读', () => {
    const r = ok({ ...base, week_parity: 'odd', valid_from: '2026-01-05', max_duration: 120 });
    const s = ruleSummary(r);
    assert.match(s, /单周/);
    assert.match(s, /2026-01-05/);
    assert.match(s, /120 分钟/);
  });
});

/* ==================== 间隔设置与调课 ==================== */

describe('最短间隔、调课与对调', () => {
  let teacher;
  let classA;
  let classB;

  it('准备：教师、两个班级', async () => {
    teacher = await register('teacher', '调课王老师');
    const a = await api('POST', '/api/classes', teacher, { name: '调课 A 班' });
    const b = await api('POST', '/api/classes', teacher, { name: '调课 B 班' });
    classA = a.data.class.id;
    classB = b.data.class.id;
  });

  it('最短间隔设置：读写与校验', async () => {
    const def = await api('GET', '/api/availability/settings', teacher);
    assert.equal(def.status, 200);
    assert.equal(def.data.min_gap_min, 0, '默认不要求间隔');

    const set = await api('PUT', '/api/availability/settings', teacher, { min_gap_min: 60 });
    assert.equal(set.status, 200);
    assert.equal(set.data.min_gap_min, 60);

    assert.equal((await api('PUT', '/api/availability/settings', teacher, { min_gap_min: -1 })).status, 400);
    assert.equal((await api('PUT', '/api/availability/settings', teacher, { min_gap_min: 999 })).status, 400);
    assert.equal((await api('PUT', '/api/availability/settings', teacher, { min_gap_min: 30.5 })).status, 400);
  });

  it('冲突预检会报出间隔不足', async () => {
    const d = '2026-11-03';
    await api('POST', '/api/lessons', teacher, { class_id: classA, date: d, start_time: '18:00', duration_min: 60, room: '301' });

    // 不重叠，只是挨得近：这时教室其实是空的，应该报「间隔不足」而不是「教室占用」
    const close = await api('GET', `/api/lessons/check?class_id=${classA}&date=${d}&start_time=19:30&duration_min=60&room=301`, teacher);
    assert.equal(close.status, 200);
    assert.equal(close.data.conflicts.length, 1);
    assert.equal(close.data.conflicts[0].type, 'gap');
    assert.match(close.data.conflicts[0].text, /间隔仅 30 分钟/);

    // 正好隔 60 分钟就不算冲突
    const okGap = await api('GET', `/api/lessons/check?class_id=${classA}&date=${d}&start_time=20:00&duration_min=60`, teacher);
    assert.equal(okGap.data.conflicts.length, 0);
  });

  it('同一位老师两节不同班的课时间重叠也算冲突', async () => {
    const d = '2026-11-04';
    await api('POST', '/api/lessons', teacher, { class_id: classA, date: d, start_time: '18:00', duration_min: 60, room: '301' });
    const r = await api('GET', `/api/lessons/check?class_id=${classB}&date=${d}&start_time=18:30&duration_min=60&room=999`, teacher);
    assert.equal(r.data.conflicts.length, 1);
    assert.equal(r.data.conflicts[0].type, 'teacher', '既不同班也不同教室，但仍是他自己的另一节课');
  });

  it('调课预检不写库，落库前会拦冲突', async () => {
    const d = '2026-11-05';
    const created = await api('POST', '/api/lessons', teacher, { class_id: classA, date: d, start_time: '18:00', duration_min: 60 });
    const id = created.data.lessons[0].id;
    await api('POST', '/api/lessons', teacher, { class_id: classA, date: d, start_time: '19:00', duration_min: 60 });

    // 挪到与第二节重叠的位置
    const dry = await api('POST', `/api/lessons/${id}/reschedule`, teacher, {
      date: d, start_time: '19:30', duration_min: 60, dry_run: true,
    });
    assert.equal(dry.status, 200);
    assert.equal(dry.data.dry_run, true);
    assert.equal(dry.data.conflicts.length, 1);

    const still = await api('GET', `/api/lessons/${id}`, teacher);
    assert.equal(still.data.lesson.start_time, '18:00', '预检不能改库');

    const blocked = await api('POST', `/api/lessons/${id}/reschedule`, teacher, {
      date: d, start_time: '19:30', duration_min: 60,
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.conflicts.length, 1);

    const forced = await api('POST', `/api/lessons/${id}/reschedule`, teacher, {
      date: d, start_time: '19:30', duration_min: 60, force: true, note: '家长要求',
    });
    assert.equal(forced.status, 200);
    assert.equal(forced.data.forced, true);
    assert.equal(forced.data.lesson.start_time, '19:30');
  });

  it('调课成功会留痕，可在课时与班级两个维度查到', async () => {
    const d = '2026-11-06';
    const created = await api('POST', '/api/lessons', teacher, { class_id: classA, date: d, start_time: '10:00', duration_min: 60 });
    const id = created.data.lessons[0].id;

    const moved = await api('POST', `/api/lessons/${id}/reschedule`, teacher, {
      date: d, start_time: '14:00', duration_min: 90, room: '302', note: '改到下午',
    });
    assert.equal(moved.status, 200);
    assert.deepEqual(moved.data.from, { date: d, start_time: '10:00', duration_min: 60, room: '' });
    assert.equal(moved.data.to.start_time, '14:00');
    assert.equal(moved.data.to.duration_min, 90);
    assert.equal(moved.data.to.room, '302');

    const own = await api('GET', `/api/lessons/${id}/changes`, teacher);
    assert.equal(own.status, 200);
    assert.equal(own.data.changes.length, 1);
    assert.equal(own.data.changes[0].action, 'reschedule');
    assert.equal(own.data.changes[0].before.start_time, '10:00');
    assert.equal(own.data.changes[0].after.start_time, '14:00');
    assert.equal(own.data.changes[0].note, '改到下午');
    assert.equal(own.data.changes[0].actor_name, '调课王老师');

    // 班级维度：这条路由必须没被 /:id 吞掉
    const byClass = await api('GET', `/api/lessons/changes?class_id=${classA}`, teacher);
    assert.equal(byClass.status, 200);
    assert.ok(byClass.data.changes.length >= 1);
    assert.equal(byClass.data.changes[0].class_name, '调课 A 班');
  });

  it('原地不动的调课会被拒绝', async () => {
    const d = '2026-11-07';
    const created = await api('POST', '/api/lessons', teacher, { class_id: classA, date: d, start_time: '10:00', duration_min: 60 });
    const id = created.data.lessons[0].id;
    const same = await api('POST', `/api/lessons/${id}/reschedule`, teacher, { date: d, start_time: '10:00', duration_min: 60 });
    assert.equal(same.status, 400);
  });

  it('对调两节课的时间与教室', async () => {
    const d1 = '2026-11-09';
    const d2 = '2026-11-10';
    const a = await api('POST', '/api/lessons', teacher, { class_id: classA, date: d1, start_time: '09:00', duration_min: 60, room: 'A1' });
    const b = await api('POST', '/api/lessons', teacher, { class_id: classB, date: d2, start_time: '15:00', duration_min: 90, room: 'B2' });
    const idA = a.data.lessons[0].id;
    const idB = b.data.lessons[0].id;

    const dry = await api('POST', `/api/lessons/${idA}/swap`, teacher, { other_id: idB, dry_run: true });
    assert.equal(dry.status, 200);
    assert.equal(dry.data.dry_run, true);

    const before = await api('GET', `/api/lessons/${idA}`, teacher);
    assert.equal(before.data.lesson.date, d1, '预检不能改库');

    const done = await api('POST', `/api/lessons/${idA}/swap`, teacher, { other_id: idB });
    assert.equal(done.status, 200);

    const afterA = await api('GET', `/api/lessons/${idA}`, teacher);
    const afterB = await api('GET', `/api/lessons/${idB}`, teacher);
    assert.equal(afterA.data.lesson.date, d2);
    assert.equal(afterA.data.lesson.start_time, '15:00');
    assert.equal(afterA.data.lesson.duration_min, 90);
    assert.equal(afterA.data.lesson.room, 'B2');
    assert.equal(afterB.data.lesson.date, d1);
    assert.equal(afterB.data.lesson.start_time, '09:00');
    assert.equal(afterB.data.lesson.room, 'A1');

    const logA = await api('GET', `/api/lessons/${idA}/changes`, teacher);
    assert.equal(logA.data.changes[0].action, 'swap');
    assert.equal(logA.data.changes[0].after.with, idB);
  });

  it('对调自身、已取消的课时都会被拒绝', async () => {
    const d = '2026-11-11';
    const a = await api('POST', '/api/lessons', teacher, { class_id: classA, date: d, start_time: '09:00', duration_min: 60 });
    const idA = a.data.lessons[0].id;
    assert.equal((await api('POST', `/api/lessons/${idA}/swap`, teacher, { other_id: idA })).status, 400);
    assert.equal((await api('POST', `/api/lessons/${idA}/swap`, teacher, { other_id: 999999 })).status, 404);

    await api('PUT', `/api/lessons/${idA}`, teacher, { status: 'canceled' });
    const move = await api('POST', `/api/lessons/${idA}/reschedule`, teacher, { date: d, start_time: '11:00', duration_min: 60 });
    assert.equal(move.status, 400, '已取消的课时不能调课');
  });

  it('别的老师不能调我的课', async () => {
    const other = await register('teacher', '局外老师');
    const d = '2026-11-12';
    const created = await api('POST', '/api/lessons', teacher, { class_id: classA, date: d, start_time: '09:00', duration_min: 60 });
    const id = created.data.lessons[0].id;
    const r = await api('POST', `/api/lessons/${id}/reschedule`, other, { date: d, start_time: '11:00', duration_min: 60 });
    assert.equal(r.status, 404, '别人的课在他的可见范围外');
  });
});

/* ==================== 规则接入智能协调 ==================== */

describe('规则影响智能协调结果', () => {
  let teacher;
  let classId;
  let studentId;

  it('准备：教师、班级与一名学生', async () => {
    teacher = await register('teacher', '规则李老师');
    const c = await api('POST', '/api/classes', teacher, { name: '规则测试班' });
    classId = c.data.class.id;
    const s = await api('POST', `/api/classes/${classId}/students`, teacher, { name: '规则学生' });
    studentId = s.data.student.id;
    await api('PUT', `/api/availability/student/${studentId}`, teacher, {
      windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start_time: '08:00', end_time: '22:00' })),
    });
  });

  it('单双周规则只在对应周产生候选时段', async () => {
    // 2026-11-03 与 2026-11-10 是相邻的两个周二
    const p1 = isoWeek('2026-11-03') % 2 === 1 ? 'odd' : 'even';
    const p2 = p1 === 'odd' ? 'even' : 'odd';
    await api('PUT', '/api/availability', teacher, {
      windows: [{ weekday: 2, start_time: '18:00', end_time: '21:00', week_parity: p1 }],
    });
    const r = await api('GET', `/api/availability/match?class_id=${classId}&duration_min=60&from=2026-11-03&to=2026-11-10`, teacher);
    assert.equal(r.status, 200);
    const dates = [...new Set(r.data.slots.map((s) => s.date))];
    assert.deepEqual(dates, ['2026-11-03'], `只应出 ${p1} 周那天，实际 ${dates.join(',')}`);
  });

  it('生效日期范围之外的日期不出候选', async () => {
    await api('PUT', '/api/availability', teacher, {
      windows: [{ weekday: 2, start_time: '18:00', end_time: '21:00', valid_from: '2026-11-03', valid_to: '2026-11-03' }],
    });
    const r = await api('GET', `/api/availability/match?class_id=${classId}&duration_min=60&from=2026-11-03&to=2026-11-17`, teacher);
    const dates = [...new Set(r.data.slots.map((s) => s.date))];
    assert.deepEqual(dates, ['2026-11-03']);
  });

  it('时长上限会挡掉过长的课', async () => {
    await api('PUT', '/api/availability', teacher, {
      windows: [{ weekday: 2, start_time: '18:00', end_time: '21:00', max_duration: 60 }],
    });
    const fit = await api('GET', `/api/availability/match?class_id=${classId}&duration_min=60&from=2026-11-03&to=2026-11-03`, teacher);
    assert.ok(fit.data.slots.length > 0, '60 分钟应能排');
    const tooLong = await api('GET', `/api/availability/match?class_id=${classId}&duration_min=120&from=2026-11-03&to=2026-11-03`, teacher);
    assert.equal(tooLong.data.slots.length, 0, '120 分钟超过上限，不该有候选');
  });

  it('学生的时长上限同样生效', async () => {
    await api('PUT', '/api/availability', teacher, {
      windows: [{ weekday: 2, start_time: '18:00', end_time: '21:00' }],
    });
    await api('PUT', `/api/availability/student/${studentId}`, teacher, {
      windows: [{ weekday: 2, start_time: '18:00', end_time: '21:00', max_duration: 60 }],
    });
    const r = await api('GET', `/api/availability/match?class_id=${classId}&duration_min=120&from=2026-11-03&to=2026-11-03`, teacher);
    // 候选时段来自老师的空档（仍然会列出），但学生不该被算成有空
    assert.ok(r.data.slots.length > 0, '老师这天有空，候选仍会列出');
    assert.ok(r.data.slots.every((s) => s.free_count === 0), '学生只接受 60 分钟，120 分钟的课不该算他有空');
    assert.equal(r.data.students_with_windows, 1, '学生仍算填过时段，只是时长不匹配');
  });

  it('最短间隔也会影响智能协调', async () => {
    await api('PUT', '/api/availability/settings', teacher, { min_gap_min: 60 });
    await api('PUT', '/api/availability', teacher, {
      windows: [{ weekday: 2, start_time: '18:00', end_time: '21:00' }],
    });
    await api('PUT', `/api/availability/student/${studentId}`, teacher, {
      windows: [{ weekday: 2, start_time: '18:00', end_time: '22:00' }],
    });
    // 18:00-19:00 先占掉一节
    await api('POST', '/api/lessons', teacher, { class_id: classId, date: '2026-11-03', start_time: '18:00', duration_min: 60 });

    const r = await api('GET', `/api/availability/match?class_id=${classId}&duration_min=60&from=2026-11-03&to=2026-11-03`, teacher);
    const starts = r.data.slots.map((s) => s.start_time);
    assert.ok(!starts.includes('18:30'), '与自己那节课重叠，必须排除');
    assert.ok(!starts.includes('19:00'), '只隔 0 分钟，应被最短间隔挡掉');
    assert.ok(starts.includes('20:00'), '正好隔 60 分钟，应保留');
  });
});

// 顶层收尾：所有 describe 跑完再关服务
after(() => server.close());
