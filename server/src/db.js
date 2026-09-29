import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 测试时可用 EDUHUB_DB_PATH=':memory:' 覆盖
export const dbPath = process.env.EDUHUB_DB_PATH || path.join(__dirname, '../data/eduhub.db');
if (dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

// 照片与签名存文件（不进数据库），目录随数据文件走
export const uploadsDir = dbPath === ':memory:'
  ? path.join(process.env.TMPDIR || '/tmp', `eduhub-uploads-${process.pid}`)
  : path.join(path.dirname(dbPath), 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student','teacher','admin','super')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  feed_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#4F6EF2',
  invite_code TEXT NOT NULL UNIQUE,
  rate REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 60,
  room TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','done','canceled')),
  checkin_photo TEXT,
  teacher_signature TEXT,
  checkin_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('present','late','absent','leave')),
  signature TEXT,
  photo TEXT,
  signed_at TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS lesson_records (
  lesson_id INTEGER PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  homework TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 每周可上课时段：老师表示「能授课」，学生表示「能上课」，用于智能协调时间
CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 请假申请（kind=leave）与预约课程申请（kind=booking）
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('leave','booking')),
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT,
  start_time TEXT,
  duration_min INTEGER,
  room TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','canceled')),
  decided_note TEXT NOT NULL DEFAULT '',
  created_lesson_id INTEGER,
  decided_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  decided_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_lessons_date ON lessons(date);
CREATE INDEX IF NOT EXISTS idx_lessons_class ON lessons(class_id);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_students_user ON students(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_lesson ON attendance(lesson_id);
CREATE INDEX IF NOT EXISTS idx_availability_user ON availability(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_teacher ON requests(teacher_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_student ON requests(student_id, status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 站内通知：申请提交/审批结果等，手动登记的学生没有账号则不发
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);

-- 审计日志：管理员敏感操作（建号/改角色/启停用/重置密码/删号），仅超管可查
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_id INTEGER NOT NULL,
  operator_name TEXT NOT NULL,
  operator_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id INTEGER,
  target_name TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

-- 法定节假日同步缓存：按年存一份外部数据源的结果，覆盖内置兜底表。
-- 存库而不是只放内存，是为了离线部署重启后依然用得上最后一次同步到的数据。
CREATE TABLE IF NOT EXISTS holiday_sync (
  year TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  fetched_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

/** 老库补列：SQLite 没有 ADD COLUMN IF NOT EXISTS */
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

/**
 * users.role 的 CHECK 约束原本只允许 teacher/student，
 * 增加管理员角色只能按 SQLite 官方的「重建表」流程改。
 */
function migrateUserRoles() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!row?.sql || row.sql.includes("'admin'")) return;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE users_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('student','teacher','admin','super')),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
        feed_token TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )
    `);
    // 原有用户表可能还没 status / feed_token 列
    const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    const hasStatus = cols.includes('status');
    const hasFeed = cols.includes('feed_token');
    db.exec(`INSERT INTO users_migrated (id, name, phone, password_hash, role, status, feed_token, created_at)
             SELECT id, name, phone, password_hash, role,
                    ${hasStatus ? "COALESCE(status, 'active')" : "'active'"},
                    ${hasFeed ? 'feed_token' : 'NULL'},
                    created_at FROM users`);
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_migrated RENAME TO users');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
migrateUserRoles();

// v0.2 起：签到留痕（课堂照片 / 签名）
ensureColumn('lessons', 'checkin_photo', 'TEXT');
ensureColumn('lessons', 'teacher_signature', 'TEXT');
ensureColumn('lessons', 'checkin_at', 'TEXT');
ensureColumn('attendance', 'signature', 'TEXT');
ensureColumn('attendance', 'photo', 'TEXT');
ensureColumn('attendance', 'signed_at', 'TEXT');

// v0.3 起：账号状态、日历订阅令牌、班级课酬
ensureColumn('users', 'status', "TEXT NOT NULL DEFAULT 'active'");
ensureColumn('users', 'feed_token', 'TEXT');
// v0.6 起：界面主题（light / dark / system），随账号跨设备保存
ensureColumn('users', 'theme', "TEXT NOT NULL DEFAULT 'system' CHECK(theme IN ('light','dark','system'))");
ensureColumn('classes', 'rate', 'REAL NOT NULL DEFAULT 0');

/** 本地时区的今天，格式 YYYY-MM-DD */
export function today() {
  return new Date().toLocaleDateString('en-CA');
}
