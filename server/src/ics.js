import { toMin, minToTime } from './util.js';

/**
 * iCalendar(.ics) 生成与解析。
 * 采用「浮动本地时间」（不带 Z、不带 TZID），手机上导入后按设备本地时区显示，
 * 对只服务一个时区的排课场景最省心，兼容性也最好。
 */

const CRLF = '\r\n';

/** 转义 ICS 文本值里的特殊字符 */
export function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** 每行不超过 75 字节，超出部分折行续写（RFC 5545） */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 73) return line;
  const out = [];
  let current = Buffer.alloc(0);
  for (const ch of line) {
    const cb = Buffer.from(ch, 'utf8');
    if (current.length + cb.length > 73) {
      out.push(current.toString('utf8'));
      current = Buffer.from(' ');
    }
    current = Buffer.concat([current, cb]);
  }
  if (current.length) out.push(current.toString('utf8'));
  return out.join(CRLF);
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/** 'YYYY-MM-DD' + 'HH:MM' -> 'YYYYMMDDTHHMMSS'（浮动本地时间） */
export function icsLocal(date, time) {
  return `${String(date).replace(/-/g, '')}T${String(time).replace(':', '')}00`;
}

/**
 * 生成日历。
 * @param events [{ uid, date, start_time, duration_min, summary, location, description, status }]
 */
export function buildIcs(events, { calendarName = '师枢课表', timezone = 'Asia/Shanghai', reminderMinutes = 30 } = {}) {
  const now = stamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EduHub//Shishu EduHub//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `X-WR-TIMEZONE:${timezone}`,
  ];

  for (const e of events) {
    const endTime = minToTime(toMin(e.start_time) + Number(e.duration_min || 60));
    // 结束时间跨天时归到 23:59，避免日历客户端解析出负时长
    const sameDay = toMin(e.start_time) + Number(e.duration_min || 60) <= 1440;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsLocal(e.date, e.start_time)}`,
      `DTEND:${sameDay ? icsLocal(e.date, endTime) : icsLocal(e.date, '23:59')}`,
      `SUMMARY:${escapeText(e.summary)}`
    );
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    lines.push(`STATUS:${e.status === 'canceled' ? 'CANCELLED' : 'CONFIRMED'}`);
    if (reminderMinutes > 0) {
      lines.push(
        'BEGIN:VALARM',
        `TRIGGER:-PT${reminderMinutes}M`,
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(e.summary)}`,
        'END:VALARM'
      );
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join(CRLF) + CRLF;
}

/** 解析一行属性 "NAME;PARAM=..:VALUE" */
function parseLine(line) {
  const idx = line.indexOf(':');
  if (idx < 0) return null;
  const left = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const [name, ...paramParts] = left.split(';');
  const params = {};
  for (const p of paramParts) {
    const [k, v] = p.split('=');
    if (k) params[k.toUpperCase()] = v;
  }
  return { name: name.toUpperCase(), params, value };
}

function unescapeText(value) {
  return String(value ?? '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** 'YYYYMMDDTHHMMSS' / 'YYYYMMDD' / 带 Z -> { date, time } 本地时间 */
function parseIcsDateTime(value, params = {}) {
  const raw = String(value || '').trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(raw);
  if (!m) return null;
  const [, y, mo, d, hh, mi, , z] = m;
  const date = `${y}-${mo}-${d}`;
  if (hh === undefined) return { date, time: null, allDay: true };
  // 带 Z 的按 UTC 换算成本地时间，浮动时间直接采用
  if (z) {
    const utc = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi)));
    return {
      date: utc.toLocaleDateString('en-CA'),
      time: `${pad(utc.getHours())}:${pad(utc.getMinutes())}`,
      allDay: false,
    };
  }
  return { date, time: `${hh}:${mi}`, allDay: false };
}

/**
 * 解析 .ics 文本，返回事件列表。
 * 支持折行续写、VALUE=DATE 全天、带 Z 的 UTC 时间。
 */
export function parseIcs(text) {
  // 先按物理行拆，再合并折行（以空格或制表符开头的行是上一行的续行）
  const rawLines = String(text || '').split(/\r\n|\n|\r/);
  const lines = [];
  for (const line of rawLines) {
    if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }

  const events = [];
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const parsed = parseLine(trimmed);
    if (!parsed) continue;
    const { name, params, value } = parsed;
    if (name === 'DTSTART') current.dtstart = parseIcsDateTime(value, params);
    else if (name === 'DTEND') current.dtend = parseIcsDateTime(value, params);
    else if (name === 'SUMMARY') current.summary = unescapeText(value);
    else if (name === 'LOCATION') current.location = unescapeText(value);
    else if (name === 'DESCRIPTION') current.description = unescapeText(value);
    else if (name === 'UID') current.uid = value;
    else if (name === 'STATUS') current.status = value.toUpperCase();
  }

  return events
    .filter((e) => e.dtstart?.date && e.summary)
    .map((e) => {
      let duration = 60;
      if (e.dtstart.time && e.dtend?.time) {
        duration = e.dtend.date === e.dtstart.date
          ? toMin(e.dtend.time) - toMin(e.dtstart.time)
          : 1440 - toMin(e.dtstart.time); // 跨天：算到当天结束
        if (duration <= 0) duration = 60;
      }
      return {
        uid: e.uid || '',
        date: e.dtstart.date,
        start_time: e.dtstart.time || '09:00',
        duration_min: Math.min(Math.max(duration, 15), 480),
        all_day: !!e.dtstart.allDay,
        topic: e.summary || '',
        room: e.location || '',
        description: e.description || '',
        canceled: e.status === 'CANCELLED',
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));
}
