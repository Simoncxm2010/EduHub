import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EDUHUB_DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-rooms';

const { createApp } = await import('../src/app.js');
// today() 在 db.js 里（util.js 只有纯函数）
const { today } = await import('../src/db.js');

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

/** 排一节课，返回课时 id */
async function addLesson(tok, body) {
  const r = await api('POST', '/api/lessons', tok, { duration_min: 60, ...body });
  assert.equal(r.status, 201, `排课失败: ${JSON.stringify(r.data)}`);
  return r.data.lessons[0].id;
}

function roomOf(data, name) {
  const room = data.rooms.find((r) => r.name === name);
  assert.ok(room, `结果里应有教室 ${name}，实际 ${data.rooms.map((r) => r.name).join(',') || '（空）'}`);
  return room;
}

function dayOf(room, date) {
  const day = room.days.find((d) => d.date === date);
  assert.ok(day, `教室 ${room.name} 在 ${date} 应有排课`);
  return day;
}

describe('教室占用视图', () => {
  let teacher;
  let student;
  let classA;
  let classB;
  let colorA;

  it('准备：教师、学生、两个班级', async () => {
    teacher = await register('teacher', '教室王老师');
    student = await register('student', '教室学生');
    const a = await api('POST', '/api/classes', teacher, { name: '教室 A 班' });
    const b = await api('POST', '/api/classes', teacher, { name: '教室 B 班' });
    classA = a.data.class.id;
    classB = b.data.class.id;
    // 班级颜色是随机挑的，照着建班结果断言，别写死
    colorA = a.data.class.color;
  });

  it('按教室分组，没填教室的课时不进视图', async () => {
    const d = '2026-12-01';
    const idA = await addLesson(teacher, { class_id: classA, date: d, start_time: '09:00', duration_min: 90, room: '301' });
    await addLesson(teacher, { class_id: classB, date: d, start_time: '14:00', duration_min: 60, room: '302' });
    // 没填教室：不属于任何教室的占用
    await addLesson(teacher, { class_id: classA, date: d, start_time: '16:00', duration_min: 60, room: '' });

    const r = await api('GET', `/api/rooms?from=${d}&to=${d}`, teacher);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.range, [d, d]);
    assert.deepEqual(r.data.rooms.map((x) => x.name), ['301', '302'], '只统计填了教室的课时');
    assert.equal(r.data.summary.room_count, 2);
    assert.equal(r.data.summary.lesson_count, 2);
    assert.equal(r.data.summary.conflict_count, 0);

    const lesson = dayOf(roomOf(r.data, '301'), d).lessons[0];
    assert.deepEqual(lesson, {
      id: idA,
      date: d,
      start_time: '09:00',
      end_time: '10:30',
      duration_min: 90,
      class_id: classA,
      class_name: '教室 A 班',
      class_color: colorA,
      teacher_name: '教室王老师',
      status: 'scheduled',
      conflict: false,
    });
    assert.equal(roomOf(r.data, '301').lesson_count, 1);
    assert.equal(roomOf(r.data, '301').has_conflict, false);
  });

  it('已取消的课时不占教室', async () => {
    const d = '2026-12-01';
    const id = await addLesson(teacher, { class_id: classA, date: d, start_time: '10:00', duration_min: 60, room: '303' });
    const before = await api('GET', `/api/rooms?from=${d}&to=${d}`, teacher);
    roomOf(before.data, '303');

    await api('PUT', `/api/lessons/${id}`, teacher, { status: 'canceled' });
    const after = await api('GET', `/api/rooms?from=${d}&to=${d}`, teacher);
    assert.equal(after.data.rooms.some((x) => x.name === '303'), false, '取消后不再占用教室');
    assert.equal(roomOf(after.data, '301').days.length, 1, '其他教室不受影响');
  });

  it('同一教室时间重叠的课时算冲突', async () => {
    const d = '2026-12-02';
    const idA = await addLesson(teacher, { class_id: classA, date: d, start_time: '18:00', duration_min: 60, room: '401' });
    const idB = await addLesson(teacher, { class_id: classB, date: d, start_time: '18:30', duration_min: 60, room: '401' });
    // 同一间教室但不重叠：不算冲突
    const idC = await addLesson(teacher, { class_id: classA, date: d, start_time: '20:00', duration_min: 60, room: '401' });

    const r = await api('GET', `/api/rooms?from=${d}&to=${d}`, teacher);
    const room = roomOf(r.data, '401');
    const day = dayOf(room, d);
    assert.equal(room.lesson_count, 3);
    assert.equal(day.conflicts.length, 1);
    assert.deepEqual(day.conflicts[0].lesson_ids, [idA, idB]);
    assert.equal(day.conflict, true);

    const byId = new Map(day.lessons.map((l) => [l.id, l]));
    assert.equal(byId.get(idA).conflict, true);
    assert.equal(byId.get(idB).conflict, true);
    assert.equal(byId.get(idC).conflict, false, '不重叠的课不该被标成冲突');

    assert.equal(r.data.summary.conflict_count, 1);
    assert.deepEqual(r.data.summary.conflicts, [
      { room: '401', date: d, lesson_ids: [idA, idB] },
    ]);
  });

  it('一节撞多节时冲突 id 不重复', async () => {
    const d = '2026-12-03';
    const first = await addLesson(teacher, { class_id: classA, date: d, start_time: '09:00', duration_min: 180, room: '402' });
    const second = await addLesson(teacher, { class_id: classB, date: d, start_time: '10:00', duration_min: 60, room: '402' });
    const third = await addLesson(teacher, { class_id: classB, date: d, start_time: '11:00', duration_min: 60, room: '402' });

    const r = await api('GET', `/api/rooms?from=${d}&to=${d}`, teacher);
    const day = dayOf(roomOf(r.data, '402'), d);
    assert.equal(day.conflicts.length, 2, '两两组合：长课分别与两节短课重叠');
    assert.equal(r.data.summary.conflict_count, 2);
    assert.deepEqual(r.data.summary.conflicts[0].lesson_ids, [first, second, third], '汇总里每节课只列一次');
  });

  it('学生无权查看教室占用', async () => {
    const r = await api('GET', '/api/rooms', student);
    assert.equal(r.status, 403);
  });

  it('日期区间最长 14 天，非法参数被挡下', async () => {
    const r = await api('GET', '/api/rooms?from=2026-12-01&to=2026-12-30', teacher);
    assert.equal(r.status, 200);
    assert.equal(r.data.clamped, true);
    assert.deepEqual(r.data.range, ['2026-12-01', '2026-12-14']);
    assert.equal(r.data.days.length, 14);
    assert.equal(r.data.summary.day_count, 14);
    // 12-01 那天的课仍在区间内，12-02 之后的也在（不会因为截断丢掉前两天）
    roomOf(r.data, '301');

    const exact = await api('GET', '/api/rooms?from=2026-12-01&to=2026-12-14', teacher);
    assert.equal(exact.data.clamped, false, '正好 14 天不算截断');
    assert.deepEqual(exact.data.range, ['2026-12-01', '2026-12-14']);

    assert.equal((await api('GET', '/api/rooms?from=2026-13-01&to=2026-12-01', teacher)).status, 400);
    assert.equal((await api('GET', '/api/rooms?from=2026-12-05&to=2026-12-01', teacher)).status, 400);
  });

  it('不带参数默认查今天', async () => {
    const r = await api('GET', '/api/rooms', teacher);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.range, [today(), today()]);
    assert.equal(r.data.days.length, 1);
    assert.ok(Array.isArray(r.data.rooms));
  });
});

// 顶层收尾：所有 describe 跑完再关服务
after(() => server.close());
