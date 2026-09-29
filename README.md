# 师枢 EduHub

为课外班老师打造的轻量教务平台：**排课 · 签到留痕 · 请假预约 · 课堂记录**。
桌面端与手机端是两套各自适配的界面，单进程部署，一人一机即可上线。

![CI](https://github.com/Simoncxm2010/EduHub/actions/workflows/ci.yml/badge.svg)

## 四种角色与权限

| 能力 | 学生 | 教师 | 管理员 | 超级管理员 |
| --- | :-: | :-: | :-: | :-: |
| 查看课表 / 课堂记录 | ✅ 本班 | ✅ 本人班级 | ✅ 全部 | ✅ 全部 |
| 拍照 + 签名签到 | ✅ 自己 | ✅ 本班学生 | ✅ | ✅ |
| 请假 / 预约课程 | ✅ | 审批 | 审批 | 审批 |
| 填写可上课时段 | ✅ | ✅ | ✅ | ✅ |
| 排课 / 智能排课 / 签到留痕 | — | ✅ | ✅ | ✅ |
| 创建班级、导入导出 | — | ✅ | ✅ | ✅ |
| 查看用户列表、重置密码、停用账号 | — | — | ✅ 教师与学生 | ✅ 全部 |
| 分配管理员 / 超管权限、删除账号 | — | — | — | ✅ |

- 管理员与超管**同时具备教学能力**（很多机构里校长也代课），可直接排课、签到。
- 账号被停用后**立即失效**：无法登录，已签发的令牌也会被拒绝。
- 第一个超管：`npm run seed:super -- <手机号> <密码> <姓名>`；
  也可在部署时设置环境变量 `EDUHUB_SUPER_PHONE`，该手机号注册即成为超管。

## 功能一览

| 模块 | 教师 | 学生 |
| --- | --- | --- |
| 班级管理 | 创建班级、邀请码、添加/移除学生、设置单节课酬 | 凭邀请码加入班级 |
| 排课 | 周日历点空档即排、周/月视图、按周重复、改期、取消、复制、批量停课 | 查看课表 |
| 智能排课 | 按「每周几 + 时间 + 日期范围」批量生成，自动跳过冲突日期，按班级历史规律预填 | — |
| 智能协调时间 | 师生各填可上课时段，系统算出双方都有空、且无排课冲突的时段，可一键排课 | 据此发起预约 |
| 签到 | 一键全到 / 出勤 · 迟到 · 缺勤 · 请假 | 自助签到、查看全班签到情况 |
| 签到留痕 | 课堂照片 + 教师签名 + 逐学生手写签名 | 自助拍照 + 手写签名 |
| 请假与预约 | 审批（通过请假自动记为「请假」；通过预约自动建课并二次校验冲突） | 提交申请、查看审批结果、撤销 |
| 课堂记录 | 记录授课内容与作业 | 查看内容与作业 |
| 站内通知 | 新申请实时提醒（铃铛角标） | 审批结果即时通知 |
| 手机日历 | 订阅地址（webcal）自动同步、导出 .ics、从 .ics 导入排课 | 订阅自己的课表 |
| 统计与导出 | 花名册出勤率、课时签到明细 CSV、按学生收费结算单 CSV、本月课酬 | 自己的申请与签到情况 |
| 管理后台 | 系统概览、用户/角色/权限、启停用、重置密码、全部班级 | — |
| 界面主题 | 亮色 / 暗色 / 跟随系统，随账号跨设备保存 | 同左 |

### 智能协调时间怎么用

1. 老师填「能授课的时间」、学生填「能上课的时间」（都是每周重复的时段）。
2. 点「开始匹配」：系统把**老师空档 ∩ 学生空档 ∩ 无排课冲突**三者取交集，按半小时粒度枚举候选，并按「有空人数」从多到少排序，同时列出谁没空。
3. 老师可以直接把候选时段排成课；学生可以据此发起预约，交由老师审批。
4. 没有学生填写时段时，结果只反映老师的空档，仍可用于排课。

### 收费结算

在班级详情页选月份，即可看到每个学生当月的课次、出勤（含迟到）、请假、缺勤与应收金额
（出勤 × 单节课酬），一键导出带 BOM 的结算单 CSV，Excel 直接打开。口径：出勤与迟到计费，
请假与缺勤不计费；金额只按已记录的考勤统计。

### 界面主题

「亮色 / 暗色 / 跟随系统」三档，桌面端在侧边栏底部、手机端在「我的」页切换。
默认跟随系统（自动响应手机/电脑的深色模式），选择后随账号保存——换设备登录主题一致；
未登录时按本机偏好记忆。暗色同时覆盖自绘界面与 Vant 组件（含弹层），签到签名保持白纸黑字。

### 邀请链接

班级详情页「复制」的不是光秃秃的邀请码，而是一条注册链接：
学生在微信里点开 → 注册页自动带码 → 注册完成自动加入班级。
注册页也可以手动填邀请码。

## 双端界面：不是响应式拉伸，而是两套界面

登录后按视口宽度（960px）分流到**两套独立的组件树**，共享同一套 API 与业务逻辑：

```
web/src/views/
├── Dashboard.vue …      双端包装器（按视口二选一）
├── desktop/             桌面端：原生 table / input / select + 自绘居中弹窗
└── mobile/              手机端：Vant 移动组件（底部标签栏、底部弹出）
```

| | 手机端（< 960px） | 桌面端（≥ 960px） |
| --- | --- | --- |
| 基础组件 | Vant 移动组件 | 原生控件 + 自有 `.d-*` 样式，**不使用手机式组件** |
| 导航 | 底部标签栏 | 左侧固定侧边导航（带说明文字） |
| 列表 | 卡片列表 | 数据表格（带表头、对齐、行悬停） |
| 弹窗 | 底部弹出 | 居中对话框（Esc / 点遮罩关闭） |
| 表单 | 单元格列表 | 双列表单栅格（label 在上、原生输入控件） |
| 排课 | 周条 / 月历 + 当日列表 | 周日历网格 + 月历网格 + 右侧当日面板 |
| 统计 | 每人一行进度条 | 完整表格 |

## 技术栈

- **后端**：Node.js 24（内置 `node:sqlite`，零原生依赖）+ Express + JWT
- **前端**：Vue 3 + Vite + Vant 4（仅手机端）+ PWA
- **数据库**：SQLite 单文件（`server/data/eduhub.db`）；照片与签名存 `server/data/uploads/`
- **部署**：单进程同时提供 API 与网页，支持 Docker 一键部署

## 快速开始

要求：Node.js ≥ 22.5（推荐 24 LTS）。

```bash
npm run setup        # 安装 server 与 web 依赖
npm run seed         # 写入演示账号、班级、排课与可上课时段
npm run dev:server   # 后端 http://localhost:8787
npm run dev:web      # 前端 http://localhost:5173（已代理 /api 与 /uploads）
```

### 演示账号（密码均为 `demo123456`）

| 角色 | 手机号 | 说明 |
| --- | --- | --- |
| 超级管理员 | `13800000000` | 张校长 · 可分配管理员权限、删除账号 |
| 管理员 | `13800000002` | 李教务 · 可管理教师与学生 |
| 教师 | `13800000001` | 演示王老师 · 2 个班级、含课酬与排课 |
| 学生 | `13900000001` | 演示学生小陈 · 已加入物理班，填了周一三五可上课 |

班级邀请码：`DEMO66`（初二物理培优班）

## 生产部署

### Docker（推荐）

```bash
# 先改 docker-compose.yml 里的 JWT_SECRET
docker compose up -d --build      # 访问 http://服务器IP:8787
```

### 手动部署

```bash
npm run setup && npm run build
PORT=8787 npm start               # 单进程托管 API + 静态页面
```

生产环境建议用 `.env`（参考 `.env.example`）设置 `JWT_SECRET`；
用 HTTPS 时设置 `COOKIE_SECURE=1`。手机端在浏览器菜单选择「添加到主屏幕」即可当 App 使用。

## 鉴权与隐私

- 接口用 `Authorization: Bearer <token>`；同时下发一枚 **httpOnly Cookie** 给 `/uploads`
  下的照片与签名鉴权（`<img>` 无法携带请求头），未登录访问返回 401。
- 学生只能看到自己的签名与照片，同班同学只显示「已签 / 未签」。
- 手机日历订阅地址里带专属令牌（可在「我的」重置），泄露后可一键作废。
- 导出 CSV 会中和以 `=` `+` `-` `@` 开头的单元格，防止在 Excel 中被当作公式执行。

## 项目结构

```
├── server/                   后端（Express + node:sqlite）
│   ├── src/
│   │   ├── app.js            应用装配（API + 上传目录 + 静态托管）
│   │   ├── db.js             建库建表与版本迁移
│   │   ├── middleware.js     JWT 鉴权、角色权限、图片鉴权 Cookie
│   │   ├── conflicts.js      排课冲突判定（排课与申请审批共用）
│   │   ├── ics.js            iCalendar 生成与解析
│   │   ├── seed.js           演示数据
│   │   ├── seed-super.js     创建 / 提升超级管理员
│   │   └── routes/           auth / classes / lessons / uploads /
│   │                         requests / availability / calendar / admin
│   └── tests/                接口测试（node --test）
├── web/
│   └── src/
│       ├── views/desktop/    桌面端页面
│       ├── views/mobile/     手机端页面
│       ├── ui/Modal.vue      桌面端居中弹窗
│       ├── components/       两端复用（签名画板、拍照字段、日历网格…）
│       └── nav.js            角色对应的导航项
├── Dockerfile · docker-compose.yml
└── .github/workflows/ci.yml
```

## API 概览

均以 `/api` 为前缀。除标注外都需要登录。

- `POST /auth/register` `POST /auth/login` `POST /auth/logout` `GET /auth/me` `PUT /auth/theme`
- `POST /uploads`、`GET /uploads/<file>`（图片鉴权）
- `GET/POST /classes` `GET/PUT/DELETE /classes/:id` `POST /classes/join`
- `POST/DELETE /classes/:id/students` `GET /classes/:id/stats`
- `GET/POST /lessons` `GET/PUT/DELETE /lessons/:id`
- `GET /lessons/check`（冲突预检）
- `GET /lessons/smart/suggest` `POST /lessons/smart/plan`（智能排课）
- `POST /lessons/bulk-status`（批量停课 / 复课）
- `POST /lessons/:id/duplicate` `PUT /lessons/:id/checkin`
- `PUT /lessons/:id/attendance` `PUT /lessons/:id/attendance/me` `PUT /lessons/:id/record`
- `GET /lessons/export/csv` `GET /lessons/dashboard/overview`
- `GET/POST /requests` `PUT /requests/:id/approve` `PUT /requests/:id/reject`
  `DELETE /requests/:id` `GET /requests/my-summary`
- `GET/PUT /availability` `GET /availability/class/:id` `GET /availability/match`
- `GET /calendar/feed.ics`（凭令牌，无需登录）`GET /calendar/feed-url`
  `POST /calendar/feed-token/reset` `GET /calendar/export.ics` `POST /calendar/import.ics`
- `GET /notifications` `POST /notifications/read` `DELETE /notifications`（站内通知）
- `GET /classes/:id/billing` `GET /classes/:id/billing/export`（收费统计与结算单）
- `GET /admin/stats` `GET/POST /admin/users` `PUT /admin/users/:id/role`
  `PUT /admin/users/:id/status` `PUT /admin/users/:id/password` `DELETE /admin/users/:id`
  `GET /admin/classes`（以上需管理员及以上）

运行测试：`npm test`（93 个接口用例，覆盖权限矩阵、账号启停用、签到留痕与隐私隔离、
图片鉴权、冲突检测与批量排课、智能协调、申请审批全链路、日历导入导出、CSV 注入防护、站内通知、收费结算）。

## 数据备份

`server/data/` 下就是一个完整的部署数据：

- `eduhub.db`（含 WAL）—— 业务数据
- `uploads/` —— 课堂照片与签名
- `.jwt_secret` —— 自动生成的登录密钥

备份整个目录即可；Docker 部署时该目录已挂载为数据卷。

## Roadmap

- [x] 签到拍照 + 手写签名留痕
- [x] 桌面端 / 手机端两套独立界面
- [x] 周/月日历与智能排课
- [x] 出勤统计与课时记录导出
- [x] 管理员 / 超管角色与权限分配
- [x] 请假与预约课程、智能协调时间
- [x] 手机日历订阅与导入导出
- [ ] 消息推送与站内通知
- [ ] 课时费结算单导出（按学生/按月）
- [ ] 多机构隔离与审批注册
- [ ] uni-app 原生客户端
