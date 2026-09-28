# 师枢 EduHub

为课外班老师打造的轻量教务平台：**排课 · 签到留痕 · 课堂记录**，桌面端与手机端各有适配界面，一个人、一台机器即可部署。

![CI](https://github.com/Simoncxm2010/EduHub/actions/workflows/ci.yml/badge.svg)

## 功能一览

| 模块 | 教师 | 学生 |
| --- | --- | --- |
| 登录注册 | 手机号 + 密码 | 手机号 + 密码 |
| 班级管理 | 创建班级、邀请码、添加/移除学生 | 凭邀请码加入班级 |
| 排课 | 周日历点空档即排、周/月视图、按周重复、改期、取消、完成、复制到其他日期 | 查看课表 |
| 智能排课 | 按「每周几 + 时间 + 日期范围」批量生成，自动跳过冲突日期，并按该班历史规律预填 | — |
| 签到 | 一键全到 / 出勤 · 迟到 · 缺勤 · 请假 | 查看自己的签到状态与全班签到情况 |
| 签到留痕 | 课堂照片 + 教师签名 + 逐学生手写签名 | 自助拍照 + 手写签名签到 |
| 课堂记录 | 记录授课内容与作业 | 查看内容与作业 |
| 统计与导出 | 花名册出勤率统计、课时签到明细导出 CSV | — |
| 首页概览 | 今日课程、本周课时、学生统计 | 今日课程、已加入班级 |

### 智能排课

给一个班设定规律（每周哪几天、几点、多长时间、哪间教室、起止日期），一次生成整期课程：

- **自动避让冲突**：与该班已有课程、或同一教室的其他课程时间重叠的日期会被自动跳过，并在预览里注明原因。
- **手动排除**：预览列表中点任意一天即可排除（比如放假），也可以再点回来。
- **按历史规律预填**：打开对话框时会分析该班过去的排课记录，自动填好常用的星期、时间、时长与教室，并说明「参考了该班近 N 节课」。
- **单次排课也会预检**：手工新建或复制课时前，若时段冲突会先提示再让你决定。

### 日历与排课界面

- **周视图**（桌面）：课程按时间定位，重叠课程自动分栏；鼠标移到空白时段会显示将要排课的时间，点一下即按该时间排课；当天有一根红色当前时间线。
- **月视图**：一屏看完整月的课程分布，点击某天可跳到该天（手机端直接切回周视图看当天详情）。
- **按班级筛选**：有多个班级时可用彩色标签筛选课表。

## 双端界面

同一套 SPA 与业务逻辑，按视口宽度（960px）切换两种真正不同的界面，而不是把手机界面拉宽：

| | 手机端（< 960px） | 桌面端（≥ 960px） |
| --- | --- | --- |
| 导航 | 底部标签栏 | 左侧固定侧边导航 |
| 排课 | 周条 / 月历 + 当日课程列表 | 周日历网格 / 月历网格 |
| 首页 | 渐变头图 + 统计 | 页面标题 + 统计卡片行 |
| 班级 / 课时 | 单列卡片 | 卡片网格、左右两栏（留痕与记录 / 签到名单） |
| 统计 | 每人一行的进度条列表 | 完整表格 |
| 弹窗 | 底部弹出 | 居中对话框 |

## 技术栈

- **后端**：Node.js 24（内置 `node:sqlite`，零原生依赖）+ Express + JWT
- **前端**：Vue 3 + Vite + Vant 4 + PWA（手机可添加到主屏幕当 App 用）
- **数据库**：SQLite 单文件（`server/data/eduhub.db`）；照片与签名存 `server/data/uploads/`
- **部署**：单进程同时提供 API 与网页，支持 Docker 一键部署

## 鉴权与隐私

- 登录后前端用 `Authorization: Bearer` 调接口；同时服务端下发一枚 **httpOnly Cookie**，因为 `<img>` 无法携带请求头，`/uploads` 下的课堂照片与学生签名要靠它鉴权（未登录访问返回 401）。
- 照片与签名只在同一班级的师生之间可见；学生仅能看到自己的签名与照片，同班同学只显示「已签 / 未签」。

### 签到留痕（v0.2）

- **教师**：可拍一张课堂照片、手写教师签名确认本节课完成，并逐个把手机递给学生在屏幕上签名；已签名的学生显示签名缩略图，可点击放大、删除或重签。
- **学生**：在自己手机上选择签到状态（出勤 / 迟到 / 请假），拍一张现场照片（选填）并手写签名后提交，即为完成签到。
- **存储**：图片在浏览器端先压缩（长边 ≤ 1280px，JPEG），再上传到服务端存为文件，数据库只记录地址；单张照片上限 6MB、签名 1MB，且只接受本站上传目录的地址，避免外部链接写入。
- **隐私**：学生只能看到自己的签名与照片；同班同学的签名仅显示「已签 / 未签」。

## 双端界面

同一套 SPA 与业务逻辑，按视口宽度（960px）切换两种真正不同的界面，而不是把手机界面拉宽：

| | 手机端（< 960px） | 桌面端（≥ 960px） |
| --- | --- | --- |
| 导航 | 底部标签栏 | 左侧固定侧边导航 |
| 排课 | 周条 + 当日课程列表 | 周日历网格，课程按时间定位、重叠自动分栏，点空白时段直接排课 |
| 首页 | 渐变头图 + 统计 | 页面标题 + 统计卡片行 |
| 班级 / 课时 | 单列卡片 | 卡片网格、左右两栏（留痕与记录 / 签到名单） |
| 弹窗 | 底部弹出 | 居中对话框 |

## 技术栈

- **后端**：Node.js 24（内置 `node:sqlite`，零原生依赖）+ Express + JWT
- **前端**：Vue 3 + Vite + Vant 4 + PWA（手机可添加到主屏幕当 App 用）
- **数据库**：SQLite 单文件（`server/data/eduhub.db`）；照片与签名存 `server/data/uploads/`
- **部署**：单进程同时提供 API 与网页，支持 Docker 一键部署


## 快速开始（开发）

要求：Node.js ≥ 22.5（推荐 24 LTS）。

```bash
npm run setup        # 安装 server 与 web 依赖
npm run seed         # （可选）写入演示数据
npm run dev:server   # 后端 http://localhost:8787
npm run dev:web      # 前端 http://localhost:5173（已代理 /api 到 8787）
```

演示账号（执行 `npm run seed` 后可用）：

- 教师：`13800000001` / `demo123456`（含一个班级、4 名学生、本周排课）
- 班级邀请码：`DEMO66`（学生注册后凭此加入）

## 生产部署

### 方式一：Docker（推荐）

```bash
# 修改 docker-compose.yml 中的 JWT_SECRET 后：
docker compose up -d --build
# 访问 http://服务器IP:8787
```

### 方式二：手动部署

```bash
npm run setup
npm run build        # 构建前端到 web/dist
PORT=8787 npm start  # 单进程托管 API + 静态页面
```

生产环境建议用 `.env`（参考 `.env.example`）设置 `JWT_SECRET`；不设置时服务会自动生成并保存到 `server/data/.jwt_secret`。

### 手机端（App 体验）

无需发版：手机浏览器访问平台地址，在浏览器菜单选择 **「添加到主屏幕」**，即可全屏独立运行（PWA）。后端 API 为标准 REST，后续可基于 uni-app / React Native 开发原生客户端。

## 项目结构

```
├── server/               # 后端（Express + node:sqlite）
│   ├── src/
│   │   ├── index.js      # 入口
│   │   ├── app.js        # 应用装配（API + 静态托管）
│   │   ├── db.js         # 建库建表
│   │   ├── middleware.js # JWT 认证与权限
│   │   └── routes/       # auth / classes / lessons
│   ├── tests/            # API 集成测试（node --test）
│   └── data/             # SQLite 数据文件（git 忽略，注意备份）
├── web/                  # 前端（Vue 3 + Vant + Vite）
│   └── src/views/        # 登录 / 首页 / 排课 / 班级 / 课时详情 / 我的
├── scripts/gen-icons.ps1 # 重新生成 PWA 图标
├── Dockerfile
└── docker-compose.yml
```

## API 概览

均以 `/api` 为前缀，登录后携带 `Authorization: Bearer <token>`：

- `POST /auth/register` `POST /auth/login` `POST /auth/logout` `GET /auth/me`
- `POST /uploads`（图片上传，接收压缩后的 data URL）
- `GET /uploads/<file>`（需登录，凭 httpOnly Cookie 鉴权）
- `GET/POST /classes` `GET/PUT/DELETE /classes/:id` `POST /classes/join`
- `POST/DELETE /classes/:id/students` `DELETE /classes/:id/students/:sid`
- `GET /classes/:id/stats`（花名册出勤统计）
- `GET/POST /lessons` `GET/PUT/DELETE /lessons/:id`
- `GET /lessons/check`（单次排课冲突预检）
- `GET /lessons/smart/suggest`（按该班历史规律给出排课建议）
- `POST /lessons/smart/plan`（智能排课：`dry_run` 预览 / 正式批量创建）
- `GET /lessons/export/csv`（导出课时与签到明细）
- `POST /lessons/:id/duplicate`（复制课时到其他日期）
- `PUT /lessons/:id/checkin`（教师留痕：课堂照片 + 教师签名）
- `PUT /lessons/:id/attendance`（教师按名单保存签到与签名）
- `PUT /lessons/:id/attendance/me`（学生自助拍照 + 签名签到）
- `PUT /lessons/:id/record`（课堂记录）
- `GET /lessons/dashboard/overview`（首页概览）

运行测试：`npm test`（43 个接口用例，覆盖权限、签到留痕、隐私隔离、图片校验、冲突检测与批量排课、统计与导出）。

## 数据备份

业务数据与留痕文件都在 `server/data/` 下：

- `server/data/eduhub.db`（含 WAL 文件）—— 所有业务数据
- `server/data/uploads/` —— 课堂照片与签名图片
- `server/data/.jwt_secret` —— 自动生成的登录密钥

备份整个 `server/data/` 目录即可；Docker 部署时该目录已挂载为数据卷。

## Roadmap

- [x] 签到拍照 + 手写签名留痕
- [x] 桌面端 / 手机端双界面
- [x] 周/月日历视图与智能排课
- [x] 出勤统计与课时记录导出
- [ ] 课时费/课酬统计
- [ ] 学生请假申请与消息通知
- [ ] 管理员审批注册与多机构支持
- [ ] 导出 PDF 课表 / 打印
- [ ] uni-app 原生客户端
