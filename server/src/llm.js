/**
 * 大模型识别接口（预留）——把老师手里的「自然语言 / 聊天截图」转成结构化可上课时段。
 *
 * 契约（唯一对外入口）：
 *   recognizeAvailability({ text, image }) -> { windows, provider, warnings, raw }
 *   windows: [{ weekday: 0-6, start_time: 'HH:MM', end_time: 'HH:MM', note }]
 *
 * 设计要点：
 * 1. 双通道。配了 EDUHUB_LLM_API_KEY 就走大模型；没配就走内置规则解析，
 *    保证这个功能在没有任何外部依赖时也能用。
 * 2. 大模型失败自动降级到规则解析，绝不让排课流程卡住。
 * 3. 大模型输出一律经过 normalizeWindows() 校验（星期范围、时间格式、起止先后、去重、条数上限），
 *    不信任模型返回的任何字段。
 * 4. 任何带图片的请求必须走大模型，规则解析看不懂图。
 *
 * 兼容 OpenAI 的 /chat/completions 协议，因此 OpenAI、DeepSeek、Moonshot、
 * 智谱以及本地 Ollama / vLLM 都能直接用，只要改 EDUHUB_LLM_BASE_URL 与 EDUHUB_LLM_MODEL。
 */

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_WINDOWS = 40;

/** 星期中文 -> 0-6（周日=0，与数据库一致） */
const WEEKDAY_MAP = { 日: 0, 天: 0, 末: 6, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 0 };
const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function llmConfig() {
  const apiKey = process.env.EDUHUB_LLM_API_KEY || '';
  const baseUrl = (process.env.EDUHUB_LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = process.env.EDUHUB_LLM_MODEL || DEFAULT_MODEL;
  return {
    configured: !!apiKey,
    model,
    base_url: baseUrl,
    // 不把 key 回给前端
    vision: process.env.EDUHUB_LLM_VISION !== '0',
  };
}

function timeoutMs() {
  const n = Number(process.env.EDUHUB_LLM_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/* ==================== 输出校验 ==================== */

const isTimeStr = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const toMin = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
};

/**
 * 把任意来源（大模型 / 规则解析）的时段数组收敛成合法数据。
 * 非法条目直接丢弃，不做猜测。
 */
export function normalizeWindows(input) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(input) ? input : [];

  for (const raw of list) {
    const weekday = Number(raw?.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    const start = isTimeStr(raw?.start_time) ? raw.start_time : null;
    const end = isTimeStr(raw?.end_time) ? raw.end_time : null;
    if (!start || !end) continue;
    if (toMin(start) >= toMin(end)) continue;

    const note = String(raw?.note ?? '').slice(0, 60);
    const key = `${weekday}|${start}|${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ weekday, start_time: start, end_time: end, note });
    if (out.length >= MAX_WINDOWS) break;
  }

  out.sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
  return out;
}

/* ==================== 内置规则解析 ==================== */

const MERIDIEM_AM = ['上午', '早上', '早晨', '凌晨'];
const MERIDIEM_PM = ['下午', '傍晚', '晚上', '夜里', '晚间'];

/** 把小时按「上午/下午/晚上」修成 24 小时制 */
function applyMeridiem(hour, meridiem) {
  if (!meridiem) return hour;
  if (MERIDIEM_AM.includes(meridiem)) {
    // 上午12点按 0 点处理更符合「凌晨」语境；其余保持
    if (meridiem === '凌晨' && hour === 12) return 0;
    return hour;
  }
  if (MERIDIEM_PM.includes(meridiem)) return hour < 12 ? hour + 12 : hour;
  if (meridiem === '中午') return hour >= 11 ? hour : hour + 12;
  return hour;
}

const pad = (n) => String(n).padStart(2, '0');
const fmt = (h, m) => `${pad(h)}:${pad(m)}`;

/**
 * 扫描文本里的时间点。
 * 只有「带上午/下午等前缀」「带 : 点 时 半」「紧邻区间连接符」的数字才会被当成时间，
 * 避免把「2026年」「3个人」这类数字误读成时间。
 */
function findTimeTokens(text) {
  const re = /(上午|早上|早晨|凌晨|中午|下午|傍晚|晚上|夜里|晚间)?\s*(\d{1,2})\s*(?:[:：]\s*(\d{1,2})|点半|点\s*(\d{1,2})?\s*分?|时\s*(\d{1,2})?\s*分?)?/g;
  const tokens = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, meridiem, hh, colonMin, dianMin, shiMin] = m;
    const hour = Number(hh);
    if (hour > 24) continue;
    let minute = 0;
    if (colonMin !== undefined) minute = Number(colonMin);
    else if (m[0].includes('点半')) minute = 30;
    else if (dianMin !== undefined && dianMin !== '') minute = Number(dianMin);
    else if (shiMin !== undefined && shiMin !== '') minute = Number(shiMin);
    if (minute > 59) continue;

    const decorated = !!meridiem || /[:：]|点|时|半/.test(m[0]);
    tokens.push({
      start: m.index,
      end: m.index + m[0].length,
      hour,
      minute,
      meridiem: meridiem || null,
      decorated,
    });
  }
  return tokens;
}

const RANGE_SEP = /^\s*(?:-|—|–|~|～|至|到|—)\s*$/;

/** 解析一段文本里的所有「时间区间」 */
function findRanges(text) {
  const tokens = findTimeTokens(text);
  const ranges = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    const between = text.slice(a.end, b.start);
    // 两个时间点中间必须是纯粹的区间连接符
    if (!RANGE_SEP.test(between)) continue;
    // 两个都是裸数字（如「2026 3」）时不算区间
    if (!a.decorated && !b.decorated) continue;

    const meridiem = a.meridiem || b.meridiem
      // 前缀也可能写在更前面，如「晚上 7-9 点」
      || (text.slice(0, a.start).match(/(上午|早上|早晨|凌晨|中午|下午|傍晚|晚上|夜里|晚间)\s*$/) || [])[1]
      || null;

    let h1 = applyMeridiem(a.hour, meridiem);
    let h2 = applyMeridiem(b.hour, meridiem);
    // 「晚上7-9点」第二个数字按第一个的时段顺延，避免 9 点被当成上午
    if (h2 <= h1 && b.hour <= 12 && !b.meridiem) h2 = applyMeridiem(b.hour + 12, null);
    if (h1 > 23 || h2 > 24) continue;

    ranges.push({ start: a.start, end: b.end, from: fmt(h1, a.minute), to: fmt(h2 % 24, b.minute) });
    i++; // 已经消费掉 b
  }
  return ranges;
}

/** 解析一段文本里的星期 */
function findWeekdays(text) {
  const days = new Set();
  let matched = false;
  // 每天 / 天天 / 每日
  if (/每\s*(天|日)|天天/.test(text)) {
    for (let d = 0; d <= 6; d++) days.add(d);
    matched = true;
  }
  if (/工作日|平日/.test(text)) {
    for (const d of [1, 2, 3, 4, 5]) days.add(d);
    matched = true;
  }
  if (/周末/.test(text)) {
    days.add(6); days.add(0);
    matched = true;
  }
  const re = /(?:周|星期|礼拜)\s*([一二三四五六日天末1-7])/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = WEEKDAY_MAP[m[1]];
    if (v !== undefined) { days.add(v); matched = true; }
  }
  return { days: [...days].sort(), matched };
}

/**
 * 内置规则解析：不依赖任何外部服务。
 * 支持「周二、周四 18:30-21:00」「周三下午2点到5点」「每天 19:00-21:00」
 * 「周末上午10:00~12:00」「工作日晚上7点半到9点」等常见说法。
 */
export function parseAvailabilityText(text) {
  const src = String(text || '')
    .replace(/[：]/g, ':')
    .replace(/[，；。]/g, ',')
    .replace(/[～]/g, '~');
  const warnings = [];
  if (!src.trim()) return { windows: [], warnings: ['没有可解析的内容'] };

  // 只按「逗号/分号/换行/和」切分，不切「、」——顿号常用来并列星期
  const clauses = src.split(/[,;\n\r]+|和|以及|还有|跟|与/).map((s) => s.trim()).filter(Boolean);

  const collected = [];
  let pendingDays = [];

  for (const clause of clauses) {
    const { days, matched } = findWeekdays(clause);
    const ranges = findRanges(clause);

    if (matched && !ranges.length) {
      pendingDays = [...new Set([...pendingDays, ...days])];
      continue;
    }
    if (!ranges.length) continue;

    const useDays = matched ? days : (pendingDays.length ? pendingDays : []);
    if (!useDays.length) {
      warnings.push(`「${clause}」只识别到时间，没说是星期几`);
      continue;
    }

    // 「周二 18:00-20:00、周四 19:00-21:00」这类等长的多对多，按顺序配对
    const pairs = (useDays.length > 1 && ranges.length === useDays.length)
      ? useDays.map((d, i) => [d, ranges[i]])
      : useDays.flatMap((d) => ranges.map((r) => [d, r]));

    for (const [weekday, r] of pairs) {
      collected.push({ weekday, start_time: r.from, end_time: r.to, note: '' });
    }
    pendingDays = [];
  }

  if (pendingDays.length && !collected.length) {
    warnings.push(`识别到星期（${pendingDays.map((d) => WEEKDAY_CN[d]).join('、')}）但没识别到具体时间`);
  }
  const windows = normalizeWindows(collected);
  if (!windows.length && !warnings.length) warnings.push('没能从这段话里识别出可上课时段');
  return { windows, warnings };
}

/* ==================== 大模型通道 ==================== */

const SYSTEM_PROMPT = `你是排课助手的结构化信息抽取模块。
把用户给出的「学生有空时间」描述（可能是口语、聊天记录，或课表截图）转成 JSON。

只输出 JSON，不要解释、不要 Markdown 代码块。格式：
{"windows":[{"weekday":0-6,"start_time":"HH:MM","end_time":"HH:MM","note":""}]}

规则：
- weekday 用数字，周日=0、周一=1 …… 周六=6。
- 时间是 24 小时制的 "HH:MM"，必须补零。
- 一段话里没提到的星期不要臆造；完全无法判断时返回 {"windows":[]}。
- 多个星期共用同一时间时，拆成多条。
- 不要输出 windows 以外的字段。`;

function buildUserContent(text, image) {
  const parts = [];
  const instruction = String(text || '').trim();
  parts.push({ type: 'text', text: instruction || '请识别这张图里的可上课时间。' });
  if (image) parts.push({ type: 'image_url', image_url: { url: image } });
  return parts;
}

/** 从模型回复里抠出 JSON（容忍 ```json 包裹和前后废话） */
function extractJson(content) {
  const s = String(content || '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function callChatModel({ text, image, fetchImpl = globalThis.fetch }) {
  const key = process.env.EDUHUB_LLM_API_KEY;
  const { base_url: baseUrl, model } = llmConfig();

  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserContent(text, image) },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs()),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`大模型接口 HTTP ${res.status}${body ? `：${body.slice(0, 200)}` : ''}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error('大模型返回内容为空');
  return { content, usage: json?.usage || null };
}

/* ==================== 对外入口 ==================== */

/**
 * 识别可上课时段。永不抛错——失败会退化为规则解析并附上 warnings。
 * @param {{ text?: string, image?: string, fetchImpl?: Function }} opts
 *        image 为 data URL（data:image/png;base64,...），仅大模型通道支持
 */
export async function recognizeAvailability({ text = '', image = '', fetchImpl } = {}) {
  const { configured, model } = llmConfig();
  const rule = parseAvailabilityText(text);

  // 图片只能交给大模型
  if (image && !configured) {
    return {
      windows: rule.windows,
      provider: 'rule',
      warnings: [...rule.warnings, '未配置大模型接口，图片无法识别（仅按文字解析）'],
      raw: null,
      model: null,
    };
  }
  if (!configured) {
    return { windows: rule.windows, provider: 'rule', warnings: rule.warnings, raw: null, model: null };
  }

  try {
    const { content, usage } = await callChatModel({ text, image, fetchImpl });
    const parsed = extractJson(content);
    if (!parsed) throw new Error('大模型没有返回合法 JSON');
    const windows = normalizeWindows(parsed.windows);
    const warnings = [];
    if (!windows.length) warnings.push('大模型没有识别出可用时段');
    if (!windows.length && rule.windows.length) {
      // 大模型空手而归时，规则解析的结果往往还有救
      return {
        windows: rule.windows,
        provider: 'llm+rule',
        warnings: [...warnings, '已回退到内置规则解析的结果'],
        raw: content.slice(0, 2000),
        model,
      };
    }
    return { windows, provider: 'llm', warnings, raw: content.slice(0, 2000), model, usage };
  } catch (e) {
    return {
      windows: rule.windows,
      provider: 'rule',
      warnings: [`大模型识别失败（${e?.message || e}），已回退到内置规则解析`, ...rule.warnings],
      raw: null,
      model,
    };
  }
}

export { WEEKDAY_CN };
