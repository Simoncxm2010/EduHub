import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EDUHUB_DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-holidays';

const { createApp } = await import('../src/app.js');
const { HOLIDAYS, holidayMap, getHoliday, getAllHolidays, holidayRange, holidayRuns, isHoliday } = await import(
  '../src/holidays.js'
);
const { normalizeYear } = await import('../src/holiday-sync.js');
const { buildIcs, parseIcs } = await import('../src/ics.js');

/**
 * 国务院办公厅公布的通知原文日期，逐日抄录。
 * 这是本文件的核心价值：只校验结构的话，日期抄错也测不出来。
 * - 2025 年：国办发明电〔2024〕7 号
 * - 2026 年：国办发明电〔2025〕7 号
 */
const OFFICIAL = {
  2025: {
    holiday: [
      '2025-01-01',
      '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31',
      '2025-02-01', '2025-02-02', '2025-02-03', '2025-02-04',
      '2025-04-04', '2025-04-05', '2025-04-06',
      '2025-05-01', '2025-05-02', '2025-05-03', '2025-05-04', '2025-05-05',
      '2025-05-31', '2025-06-01', '2025-06-02',
      '2025-10-01', '2025-10-02', '2025-10-03', '2025-10-04',
      '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08',
    ],
    workday: ['2025-01-26', '2025-02-08', '2025-04-27', '2025-09-28', '2025-10-11'],
  },
  2026: {
    holiday: [
      '2026-01-01', '2026-01-02', '2026-01-03',
      '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
      '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
      '2026-04-04', '2026-04-05', '2026-04-06',
      '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
      '2026-06-19', '2026-06-20', '2026-06-21',
      '2026-09-25', '2026-09-26', '2026-09-27',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
      '2026-10-05', '2026-10-06', '2026-10-07',
    ],
    workday: ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10'],
  },
};

/** 取某年某类型的全部日期（升序），用于与官方通知做集合比对 */
function datesOf(year, type) {
  return Object.entries(holidayMap)
    .filter(([d, v]) => d.startsWith(`${year}-`) && v.type === type)
    .map(([d]) => d)
    .sort();
}

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
  return { status: res.status, data: await res.json().catch(() => null) };
}

/** 固定的教师账号：重复注册时退化为登录，便于单独跑某条用例 */
const TEACHER = { name: '假期老师', phone: '13960000009', password: '123456' };
async function teacherToken() {
  const reg = await api('POST', '/api/auth/register', null, { ...TEACHER, role: 'teacher' });
  if (reg.status === 201) return reg.data.token;
  const login = await api('POST', '/api/auth/login', null, { phone: TEACHER.phone, password: TEACHER.password });
  assert.equal(login.status, 200, '教师账号应能登录');
  return login.data.token;
}

async function makeClass(tok) {
  const r = await api('POST', '/api/classes', tok, { name: `假期班 ${Math.random().toString(36).slice(2, 7)}` });
  assert.equal(r.status, 201);
  return r.data.class.id;
}

describe('国家法定节假日数据与接口', () => {
  after(() => server.close());

  it('节假日表覆盖 2025-2027 且字段完整', () => {
    assert.ok(HOLIDAYS.length >= 14);
    for (const h of HOLIDAYS) {
      assert.ok(h.name, '每个节假日需有名称');
      assert.ok(h.dates.length >= 1, `${h.name} 需有放假日期`);
      assert.ok(Array.isArray(h.workdays), `${h.name} workdays 需为数组`);
      for (const d of [...h.dates, ...h.workdays]) {
        assert.match(d, /^\d{4}-\d{2}-\d{2}$/, `${h.name} 日期格式需为 YYYY-MM-DD`);
      }
    }
  });

  it('holidayMap 覆盖所有 dates 与 workdays，type 正确', () => {
    let holidayCount = 0;
    let workdayCount = 0;
    for (const h of HOLIDAYS) {
      for (const d of h.dates) {
        assert.equal(holidayMap[d].type, 'holiday');
        assert.equal(holidayMap[d].name, h.name);
        holidayCount++;
      }
      for (const d of h.workdays) {
        assert.equal(holidayMap[d].type, 'workday');
        assert.equal(holidayMap[d].name, h.name);
        workdayCount++;
      }
    }
    assert.equal(Object.keys(holidayMap).length, holidayCount + workdayCount);
    assert.ok(holidayCount >= 40, `2025-2027 放假日应不少于 40 天，实际 ${holidayCount}`);
  });

  it('getHoliday：放假日/调休补班日/普通日', () => {
    const ny = getHoliday('2026-01-01');
    assert.equal(ny.type, 'holiday');
    assert.equal(ny.name, '元旦');
    const makeup = getHoliday('2026-10-10');
    assert.equal(makeup.type, 'workday');
    assert.equal(makeup.name, '国庆节');
    assert.equal(getHoliday('2026-03-15'), null);
  });

  it('getAllHolidays 与 holidayMap 一致，range 覆盖全表', () => {
    assert.equal(getAllHolidays(), holidayMap);
    const [first, last] = holidayRange();
    assert.equal(first, '2025-01-01');
    assert.equal(last, '2027-01-03');
  });

  it('接口返回完整节假日表与范围', async () => {
    const reg = await api('POST', '/api/auth/register', null, {
      name: '节日老师', phone: '13960000001', password: '123456', role: 'teacher',
    });
    assert.equal(reg.status, 201);
    token = reg.data.token;

    const r = await api('GET', '/api/holidays', token);
    assert.equal(r.status, 200);
    assert.equal(r.data.holidays['2026-10-01'].name, '国庆节');
    assert.equal(r.data.holidays['2026-10-01'].type, 'holiday');
    assert.equal(r.data.holidays['2026-10-10'].type, 'workday');
    assert.deepEqual(r.data.range, ['2025-01-01', '2027-01-03']);
    assert.ok(r.data.meta.length >= 14);
  });

  it('未登录不能获取节假日', async () => {
    const r = await api('GET', '/api/holidays', null);
    assert.equal(r.status, 401);
  });

  /* ---------------- 数据正确性：与官方通知逐日比对 ---------------- */

  it('2025 年日期与国办发明电〔2024〕7 号逐日一致', () => {
    assert.deepEqual(datesOf(2025, 'holiday'), [...OFFICIAL[2025].holiday].sort());
    assert.deepEqual(datesOf(2025, 'workday'), [...OFFICIAL[2025].workday].sort());
  });

  it('2026 年日期与国办发明电〔2025〕7 号逐日一致', () => {
    assert.deepEqual(datesOf(2026, 'holiday'), [...OFFICIAL[2026].holiday].sort());
    assert.deepEqual(datesOf(2026, 'workday'), [...OFFICIAL[2026].workday].sort());

    // 曾经抄错的几处单独钉住，回归时能直接看出是哪里错了
    assert.equal(getHoliday('2026-02-23')?.type, 'holiday', '春节假期到 2 月 23 日（共 9 天）');
    assert.equal(getHoliday('2026-01-04')?.type, 'workday', '元旦 1 月 4 日补班');
    assert.equal(getHoliday('2026-05-09')?.type, 'workday', '劳动节 5 月 9 日补班');
    assert.equal(getHoliday('2026-09-20')?.type, 'workday', '国庆 9 月 20 日补班');
    assert.equal(getHoliday('2026-04-26'), null, '4 月 26 日是普通周日，不是补班日');
  });

  it('holidayRuns 把连续假期合并成整段，补班日单独成段', () => {
    assert.deepEqual(holidayRuns('2026-10-01', '2026-10-07'), [
      { from: '2026-10-01', to: '2026-10-07', name: '国庆节', type: 'holiday' },
    ]);
    assert.deepEqual(
      holidayRuns('2026-09-20', '2026-10-10').map((r) => [r.from, r.to, r.type]),
      [
        ['2026-09-20', '2026-09-20', 'workday'],
        ['2026-09-25', '2026-09-27', 'holiday'],
        ['2026-10-01', '2026-10-07', 'holiday'],
        ['2026-10-10', '2026-10-10', 'workday'],
      ]
    );
    assert.deepEqual(holidayRuns('2026-03-01', '2026-03-31'), [], '3 月没有节假日');
  });

  /* ---------------- 同步数据归一化（不联网） ---------------- */

  it('normalizeYear：除夕/初X 归入春节，过滤跨年与脏数据', () => {
    const out = normalizeYear(2026, {
      code: 0,
      holiday: {
        '02-16': { holiday: true, name: '除夕', date: '2026-02-16' },
        '02-17': { holiday: true, name: '初一', date: '2026-02-17' },
        '02-15': { holiday: true, name: '春节', date: '2026-02-15' },
        '02-14': { holiday: false, name: '春节前补班', target: '春节', date: '2026-02-14' },
        '04-04': { holiday: true, name: '清明节', date: '2026-04-04' },
        '01-01': { holiday: true, name: '元旦', date: '2027-01-01' },
        bad: { holiday: true, name: '脏数据', date: 'not-a-date' },
      },
    });
    assert.equal(out.length, 2, '跨年与格式错误的条目应被丢弃，只留春节与清明两组');
    const spring = out.find((h) => h.name === '春节');
    assert.deepEqual(spring.dates, ['2026-02-15', '2026-02-16', '2026-02-17']);
    assert.deepEqual(spring.workdays, ['2026-02-14'], '补班日按 target 归到所属节日');
    assert.deepEqual(out.find((h) => h.name === '清明节').dates, ['2026-04-04']);
    assert.equal(out.find((h) => h.name === '元旦'), undefined, '跨年条目应被丢弃');
  });

  it('normalizeYear：年份尚未公布时返回空数组而非报错', () => {
    assert.deepEqual(normalizeYear(2027, { code: 0, holiday: {} }), []);
    assert.deepEqual(normalizeYear(2027, {}), []);
    assert.deepEqual(normalizeYear(2027, null), []);
  });

  /* ---------------- 排课与日历的节假日联动 ---------------- */

  it('智能排课默认跳过法定节假日，可关闭或用 include_dates 恢复', async () => {
    const tok = await teacherToken();
    const classId = await makeClass(tok);
    // 2026-10-01 ~ 10-07 整段都是国庆假期，七天全选作候选
    const base = {
      class_id: classId, weekdays: [1, 2, 3, 4, 5, 6, 0], start_time: '09:00', duration_min: 60,
      from: '2026-10-01', to: '2026-10-07', dry_run: true,
    };

    const r = await api('POST', '/api/lessons/smart/plan', tok, base);
    assert.equal(r.status, 200);
    assert.equal(r.data.summary.total, 7);
    assert.equal(r.data.summary.holiday, 7, '七天都该被判为节假日跳过');
    assert.equal(r.data.summary.ok, 0);
    assert.equal(r.data.plan[0].status, 'skip');
    assert.match(r.data.plan[0].reason, /法定节假日/);
    assert.equal(r.data.plan[0].holiday.type, 'holiday');

    const off = await api('POST', '/api/lessons/smart/plan', tok, { ...base, skip_holidays: false });
    assert.equal(off.data.summary.ok, 7, '关闭后节假日照常排课');
    assert.equal(off.data.summary.holiday, 0);

    const inc = await api('POST', '/api/lessons/smart/plan', tok, { ...base, include_dates: ['2026-10-03'] });
    assert.equal(inc.data.summary.ok, 1);
    const restored = inc.data.plan.find((p) => p.date === '2026-10-03');
    assert.equal(restored.status, 'ok');
    assert.equal(restored.included, true);

    // 调休补班日是工作日，不该被跳过
    const makeup = await api('POST', '/api/lessons/smart/plan', tok, {
      ...base, from: '2026-10-10', to: '2026-10-10',
    });
    assert.equal(makeup.data.summary.ok, 1, '补班日照常排课');
    assert.equal(isHoliday('2026-10-10'), false);
  });

  it('批量停课支持只处理法定节假日', async () => {
    const tok = await teacherToken();
    const classId = await makeClass(tok);
    // 10-02 假期 / 10-10 补班日 / 10-13 普通周二
    for (const d of ['2026-10-02', '2026-10-10', '2026-10-13']) {
      await api('POST', '/api/lessons', tok, { class_id: classId, date: d, start_time: '09:00', duration_min: 60 });
    }

    const r = await api('POST', '/api/lessons/bulk-status', tok, {
      class_id: classId, from: '2026-10-01', to: '2026-10-31', status: 'canceled', only_holidays: true,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.updated, 1, '只有 10-02 落在法定节假日');
    assert.deepEqual(r.data.dates, ['2026-10-02']);
    assert.deepEqual(r.data.holidays, ['国庆节']);

    const list = await api('GET', `/api/lessons?from=2026-10-01&to=2026-10-31&class_id=${classId}`, tok);
    const byDate = Object.fromEntries(list.data.lessons.map((l) => [l.date, l.status]));
    assert.equal(byDate['2026-10-02'], 'canceled');
    assert.equal(byDate['2026-10-10'], 'scheduled', '补班日不受影响');
    assert.equal(byDate['2026-10-13'], 'scheduled', '普通日不受影响');
  });

  it('buildIcs 输出节假日全天事件（DTEND 排他、不占忙闲、无提醒）', () => {
    const ics = buildIcs([{
      uid: 'holiday-holiday-2026-10-01@eduhub',
      all_day: true,
      date: '2026-10-01',
      end_date: '2026-10-07',
      summary: '国庆节 放假',
    }]);
    assert.match(ics, /DTSTART;VALUE=DATE:20261001/);
    assert.match(ics, /DTEND;VALUE=DATE:20261008/, 'DTEND 为结束日次日（ICS 排他语义）');
    assert.match(ics, /TRANSP:TRANSPARENT/);
    assert.ok(!ics.includes('VALARM'), '全天节假日不该带闹钟');
  });

  it('导出 .ics 带上节假日，且再次导入时不会被当成课时', async () => {
    const tok = await teacherToken();
    const classId = await makeClass(tok);
    await api('POST', '/api/lessons', tok, {
      class_id: classId, date: '2026-10-06', start_time: '09:00', duration_min: 60,
    });

    const res = await fetch(`${base}/api/calendar/export.ics?class_id=${classId}&from=2026-10-01&to=2026-10-07`, {
      headers: { authorization: `Bearer ${tok}` },
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /SUMMARY:国庆节 放假/);
    assert.match(text, /DTSTART;VALUE=DATE:20261001/);
    assert.match(text, /DTEND;VALUE=DATE:20261008/);
    assert.match(text, /DTSTART:20261006T090000/, '课时仍是定时事件');

    // 导出文件回灌导入：全天日程应被识别为非课时
    const back = await api('POST', '/api/calendar/import.ics', tok, { class_id: classId, text });
    assert.equal(back.status, 200);
    const holidayRows = back.data.plan.filter((p) => p.topic.includes('国庆节'));
    assert.ok(holidayRows.length > 0, '导出的文件里应包含节假日事件');
    assert.ok(holidayRows.every((p) => p.status === 'skip'), '节假日全天事件不该被导入成课时');
  });

  it('接口返回同步状态，自动同步可开关', async () => {
    const r = await api('GET', '/api/holidays', token);
    assert.equal(r.status, 200);
    assert.equal(typeof r.data.sync.enabled, 'boolean');
    assert.ok(Array.isArray(r.data.sync.builtin_years));
    assert.ok(r.data.sync.builtin_years.includes('2026'));
    // 测试环境不应主动联网同步：没有同步记录时 years 为空
    assert.deepEqual(r.data.sync.years, []);
    assert.ok(r.data.today?.date, '应返回今天的节假日查询结果');
  });

  it('管理员可手动触发同步，外部源不可达时给出明确结果', async () => {
    const tok = await teacherToken();
    const denied = await api('POST', '/api/holidays/refresh', tok, { years: [2026] });
    assert.equal(denied.status, 403, '普通教师不能触发同步');
  });
});
