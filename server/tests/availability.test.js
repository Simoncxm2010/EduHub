import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EDUHUB_DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-availability';
// 单元测试不走网络：确保大模型通道处于「未配置」状态，走内置规则解析
delete process.env.EDUHUB_LLM_API_KEY;

const { createApp } = await import('../src/app.js');
const { parseAvailabilityText, normalizeWindows, recognizeAvailability, llmConfig } = await import('../src/llm.js');

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
async function register(role, name) {
  const r = await api('POST', '/api/auth/register', null, {
    name, phone: `139${stamp}${Math.floor(Math.random() * 900) + 100}`, password: '123456', role,
  });
  assert.equal(r.status, 201, `注册 ${role} 失败: ${JSON.stringify(r.data)}`);
  return r.data.token;
}

/* ==================== 规则解析（纯函数，不依赖服务） ==================== */

describe('时段文本解析（内置规则）', () => {
  const w = (text) => parseAvailabilityText(text).windows.map((x) => `${x.weekday} ${x.start_time}-${x.end_time}`);

  it('单个星期 + 24 小时制区间', () => {
    assert.deepEqual(w('周二 18:30-21:00'), ['2 18:30-21:00']);
  });

  it('顿号并列星期共用同一时间', () => {
    assert.deepEqual(w('周二、周四 18:30-21:00'), ['2 18:30-21:00', '4 18:30-21:00']);
  });

  it('中文口语：下午/上午 + 点到点', () => {
    assert.deepEqual(w('周三下午2点到5点，周六上午9点到11点'), ['3 14:00-17:00', '6 09:00-11:00']);
  });

  it('晚上 + 点半', () => {
    assert.deepEqual(w('周一 晚上7点半到9点'), ['1 19:30-21:00']);
  });

  it('「晚上7-9点」第二个数字顺延到同一时段', () => {
    assert.deepEqual(w('周二 晚上7-9点'), ['2 19:00-21:00']);
  });

  it('每天 / 工作日 / 周末 展开成对应星期', () => {
    assert.equal(w('每天 19:00-21:00').length, 7);
    assert.deepEqual(w('工作日 18:00-20:00'), ['1 18:00-20:00', '2 18:00-20:00', '3 18:00-20:00', '4 18:00-20:00', '5 18:00-20:00']);
    assert.deepEqual(w('周末 上午10:00~12:00'), ['0 10:00-12:00', '6 10:00-12:00']);
  });

  it('等长的多天多时段按顺序配对，不交叉相乘', () => {
    assert.deepEqual(w('周三 18:00-20:00、周四 19:00-21:00'), ['3 18:00-20:00', '4 19:00-21:00']);
  });

  it('不把年份、人数这类数字误读成时间', () => {
    const r = parseAvailabilityText('学生说 2026年3月 之后每周二晚上6点半到9点可以');
    assert.deepEqual(r.windows.map((x) => `${x.weekday} ${x.start_time}-${x.end_time}`), ['2 18:30-21:00']);
  });

  it('只提到星期没提到时间时给出警告而不是瞎猜', () => {
    const r = parseAvailabilityText('周二晚上和周四晚上都有空');
    assert.deepEqual(r.windows, []);
    assert.match(r.warnings.join(''), /没识别到具体时间/);
  });
});

describe('识别结果校验', () => {
  it('丢弃非法条目：越界星期、倒置时间、格式错误', () => {
    const out = normalizeWindows([
      { weekday: 9, start_time: '10:00', end_time: '11:00' },
      { weekday: 1, start_time: '9:00', end_time: '11:00' },
      { weekday: 1, start_time: '18:00', end_time: '17:00' },
      { weekday: 1, start_time: '18:00', end_time: '20:00' },
      { weekday: 1, start_time: '18:00', end_time: '20:00' },
    ]);
    assert.deepEqual(out, [{ weekday: 1, start_time: '18:00', end_time: '20:00', note: '' }]);
  });

  it('非数组输入返回空数组而不是抛错', () => {
    assert.deepEqual(normalizeWindows(null), []);
    assert.deepEqual(normalizeWindows('随便'), []);
  });

  it('未配置大模型时走规则通道并标明 provider', async () => {
    assert.equal(llmConfig().configured, false);
    const r = await recognizeAvailability({ text: '周二 18:30-21:00' });
    assert.equal(r.provider, 'rule');
    assert.deepEqual(r.windows.map((x) => `${x.weekday} ${x.start_time}-${x.end_time}`), ['2 18:30-21:00']);
  });

  it('未配置时带图片会明确提示图片无法识别', async () => {
    const r = await recognizeAvailability({ text: '周二 18:30-21:00', image: 'data:image/png;base64,AAAA' });
    assert.equal(r.provider, 'rule');
    assert.match(r.warnings.join(''), /未配置大模型接口/);
  });
});

/* ==================== 接口与权限 ==================== */

describe('老师替学生填写时段', () => {
  let teacher;
  let otherTeacher;
  let studentToken;
  let classId;
  let manualStudentId;
  let accountStudentId;

  it('准备：教师、班级、一个手动登记的学生、一个注册学生', async () => {
    teacher = await register('teacher', '代填王老师');
    otherTeacher = await register('teacher', '别的老师');

    const cls = await api('POST', '/api/classes', teacher, { name: '代填测试班' });
    assert.equal(cls.status, 201);
    classId = cls.data.class.id;

    // 手动登记的学生：没有任何账号
    const manual = await api('POST', `/api/classes/${classId}/students`, teacher, { name: '无账号小明' });
    assert.equal(manual.status, 201);
    manualStudentId = manual.data.student.id;
    assert.equal(manual.data.student.user_id, null);

    // 有账号的学生：注册后凭邀请码入班
    studentToken = await register('student', '有账号小红');
    const join = await api('POST', '/api/classes/join', studentToken, { invite_code: cls.data.class.invite_code });
    assert.equal(join.status, 201);
    const detail = await api('GET', `/api/classes/${classId}`, teacher);
    accountStudentId = detail.data.students.find((s) => s.name === '有账号小红').id;
    assert.ok(accountStudentId);
  });

  it('老师能给没有账号的学生代填时段（这是以前做不到的）', async () => {
    const r = await api('PUT', `/api/availability/student/${manualStudentId}`, teacher, {
      windows: [
        { weekday: 2, start_time: '18:30', end_time: '21:00' },
        { weekday: 6, start_time: '09:00', end_time: '12:00' },
      ],
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.windows.length, 2);
    assert.equal(r.data.windows[0].source, 'teacher', '应标记为老师代填');

    const back = await api('GET', `/api/availability/student/${manualStudentId}`, teacher);
    assert.equal(back.status, 200);
    assert.deepEqual(
      back.data.windows.map((w) => `${w.weekday} ${w.start_time}-${w.end_time}`),
      ['2 18:30-21:00', '6 09:00-12:00']
    );
  });

  it('代填的时段会进入智能协调的统计', async () => {
    // 老师自己整周 18:00-21:00 都能授课
    await api('PUT', '/api/availability', teacher, {
      windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start_time: '18:00', end_time: '21:00' })),
    });
    const from = '2026-10-06'; // 周二
    const r = await api('GET', `/api/availability/match?class_id=${classId}&duration_min=60&from=${from}&to=${from}`, teacher);
    assert.equal(r.status, 200);
    assert.equal(r.data.students_with_windows, 1, '代填后应算作「填过时段」');
    assert.ok(r.data.slots.length > 0);
    const slot = r.data.slots.find((s) => s.start_time === '19:00');
    assert.ok(slot, '应存在 19:00 的候选时段');
    assert.ok(slot.free_names.includes('无账号小明'), '代填的学生应被算作有空');
  });

  it('老师给有账号的学生代填时会写进学生自己的时段', async () => {
    const r = await api('PUT', `/api/availability/student/${accountStudentId}`, teacher, {
      windows: [{ weekday: 4, start_time: '16:00', end_time: '18:00' }],
    });
    assert.equal(r.status, 200);
    // 学生自己登录能看到
    const mine = await api('GET', '/api/availability', studentToken);
    assert.equal(mine.data.windows.length, 1);
    assert.equal(mine.data.windows[0].weekday, 4);
    assert.equal(mine.data.windows[0].source, 'teacher');
  });

  it('学生自己填过之后，以学生自己填的为准', async () => {
    await api('PUT', '/api/availability', studentToken, {
      windows: [{ weekday: 5, start_time: '10:00', end_time: '12:00' }],
    });
    const back = await api('GET', `/api/availability/student/${accountStudentId}`, teacher);
    assert.equal(back.data.windows.length, 1);
    assert.equal(back.data.windows[0].weekday, 5);
    assert.equal(back.data.windows[0].source, 'self');
  });

  it('学生时段一览会带出来源标记', async () => {
    const r = await api('GET', `/api/availability/class/${classId}`, teacher);
    assert.equal(r.status, 200);
    const manual = r.data.students.find((s) => s.name === '无账号小明');
    const account = r.data.students.find((s) => s.name === '有账号小红');
    assert.equal(manual.has_account, false);
    assert.equal(manual.filled_by_self, false);
    assert.equal(account.has_account, true);
    assert.equal(account.filled_by_self, true);
  });

  it('权限：别的老师不能代填，学生也不能替别人填', async () => {
    const other = await api('PUT', `/api/availability/student/${manualStudentId}`, otherTeacher, {
      windows: [{ weekday: 1, start_time: '08:00', end_time: '09:00' }],
    });
    assert.equal(other.status, 403);

    const stu = await api('PUT', `/api/availability/student/${manualStudentId}`, studentToken, {
      windows: [{ weekday: 1, start_time: '08:00', end_time: '09:00' }],
    });
    assert.equal(stu.status, 403, '学生不能改别人的时段');

    const missing = await api('PUT', '/api/availability/student/999999', teacher, { windows: [] });
    assert.equal(missing.status, 404);
  });

  it('代填同样要过校验：时间倒置、星期越界、超量', async () => {
    const bad = await api('PUT', `/api/availability/student/${manualStudentId}`, teacher, {
      windows: [{ weekday: 1, start_time: '20:00', end_time: '19:00' }],
    });
    assert.equal(bad.status, 400);
    const weekday = await api('PUT', `/api/availability/student/${manualStudentId}`, teacher, {
      windows: [{ weekday: 9, start_time: '18:00', end_time: '19:00' }],
    });
    assert.equal(weekday.status, 400);
    const many = await api('PUT', `/api/availability/student/${manualStudentId}`, teacher, {
      windows: Array.from({ length: 41 }, () => ({ weekday: 1, start_time: '18:00', end_time: '19:00' })),
    });
    assert.equal(many.status, 400);
  });

  it('清空代填：传空数组即可', async () => {
    const r = await api('PUT', `/api/availability/student/${manualStudentId}`, teacher, { windows: [] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.windows, []);
  });
});

describe('大模型识别接口（预留）', () => {
  let teacher;
  let studentToken;

  it('准备账号', async () => {
    teacher = await register('teacher', '识别王老师');
    studentToken = await register('student', '识别学生');
  });

  it('老师贴一段话即可拿到结构化时段，且不落库', async () => {
    const r = await api('POST', '/api/availability/recognize', teacher, {
      text: '小红说周二、周四晚上6点半到9点有空，周六上午9点到11点也行',
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.provider, 'rule');
    assert.deepEqual(
      r.data.windows.map((w) => `${w.weekday} ${w.start_time}-${w.end_time}`),
      ['2 18:30-21:00', '4 18:30-21:00', '6 09:00-11:00']
    );
    assert.equal(r.data.llm.configured, false, '未配置时前端应能知道走的是本地规则');
    // 只是建议，不应写进任何人的时段
    const mine = await api('GET', '/api/availability', teacher);
    assert.deepEqual(mine.data.windows, []);
  });

  it('识别结果必须经过校验后才返回', async () => {
    const r = await api('POST', '/api/availability/recognize', teacher, { text: '周二 25:00-26:00' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.windows, [], '非法时间不应出现在结果里');
  });

  it('参数校验：空输入、非法图片格式', async () => {
    assert.equal((await api('POST', '/api/availability/recognize', teacher, {})).status, 400);
    assert.equal((await api('POST', '/api/availability/recognize', teacher, { text: '  ' })).status, 400);
    const bad = await api('POST', '/api/availability/recognize', teacher, { image: 'data:text/plain;base64,AAAA' });
    assert.equal(bad.status, 400);
  });

  it('学生不能调用识别接口', async () => {
    const r = await api('POST', '/api/availability/recognize', studentToken, { text: '周二 18:00-20:00' });
    assert.equal(r.status, 403);
  });
});

// 顶层收尾：所有 describe 跑完再关服务，避免前面的 after 提前把服务关掉
after(() => server.close());
