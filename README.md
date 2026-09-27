# 师枢 EduHub

为课外班老师打造的轻量教务平台：**排课 · 签到 · 课堂记录**，网页端与手机端（PWA）通用，一个人、一台机器即可部署。

![CI](https://github.com/Simoncxm2010/EduHub/actions/workflows/ci.yml/badge.svg)

## 功能一览

| 模块 | 教师 | 学生 |
| --- | --- | --- |
| 登录注册 | 手机号 + 密码 | 手机号 + 密码 |
| 班级管理 | 创建班级、邀请码、添加/移除学生 | 凭邀请码加入班级 |
| 排课 | 新建课时（支持按周重复）、改期、取消、完成 | 查看课表 |
| 签到 | 一键全到 / 出勤 · 迟到 · 缺勤 · 请假 | 查看自己的签到状态 |
| 课堂记录 | 记录授课内容与作业 | 查看内容与作业 |
| 首页概览 | 今日课程、本周课时、学生统计 | 今日课程、已加入班级 |

## 技术栈

- **后端**：Node.js 24（内置 `node:sqlite`，零原生依赖）+ Express + JWT
- **前端**：Vue 3 + Vite + Vant 4（移动端优先）+ PWA（可添加到手机主屏当 App 用）
- **数据库**：SQLite 单文件（`server/data/eduhub.db`），备份即复制文件
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

- `POST /auth/register` `POST /auth/login` `GET /auth/me`
- `GET/POST /classes` `GET/PUT/DELETE /classes/:id` `POST /classes/join`
- `POST/DELETE /classes/:id/students` `DELETE /classes/:id/students/:sid`
- `GET/POST /lessons` `GET/PUT/DELETE /lessons/:id`
- `PUT /lessons/:id/attendance`（签到） `PUT /lessons/:id/record`（课堂记录）
- `GET /lessons/dashboard/overview`（首页概览）

运行测试：`npm test`（18 个接口用例）。

## 数据备份

所有业务数据都在 `server/data/eduhub.db`（及其 WAL 文件），定期停止服务或使用 `sqlite3 .backup` 复制该文件即可。

## Roadmap

- [ ] 课表月视图与导出
- [ ] 学生请假申请与消息通知
- [ ] 课时费/课酬统计
- [ ] 管理员审批注册与多机构支持
- [ ] uni-app 原生客户端
