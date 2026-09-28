# 师枢 EduHub

为课外班老师打造的轻量教务平台：**排课 · 签到留痕 · 课堂记录**，桌面端与手机端各有适配界面，一个人、一台机器即可部署。

![CI](https://github.com/Simoncxm2010/EduHub/actions/workflows/ci.yml/badge.svg)

## 功能一览

| 模块 | 教师 | 学生 |
| --- | --- | --- |
| 登录注册 | 手机号 + 密码 | 手机号 + 密码 |
| 班级管理 | 创建班级、邀请码、添加/移除学生 | 凭邀请码加入班级 |
| 排课 | 桌面端周日历点选排课（支持按周重复）、改期、取消、完成 | 查看课表 |
| 签到 | 一键全到 / 出勤 · 迟到 · 缺勤 · 请假 | 查看自己的签到状态与全班签到情况 |
| 签到留痕 | 课堂照片 + 教师签名 + 逐学生手写签名 | 自助拍照 + 手写签名签到 |
| 课堂记录 | 记录授课内容与作业 | 查看内容与作业 |
| 首页概览 | 今日课程、本周课时、学生统计 | 今日课程、已加入班级 |

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

- `POST /auth/register` `POST /auth/login` `GET /auth/me`
- `POST /uploads`（图片上传，接收压缩后的 data URL）
- `GET/POST /classes` `GET/PUT/DELETE /classes/:id` `POST /classes/join`
- `POST/DELETE /classes/:id/students` `DELETE /classes/:id/students/:sid`
- `GET/POST /lessons` `GET/PUT/DELETE /lessons/:id`
- `PUT /lessons/:id/checkin`（教师留痕：课堂照片 + 教师签名）
- `PUT /lessons/:id/attendance`（教师按名单保存签到与签名）
- `PUT /lessons/:id/attendance/me`（学生自助拍照 + 签名签到）
- `PUT /lessons/:id/record`（课堂记录）
- `GET /lessons/dashboard/overview`（首页概览）
- `GET /uploads/<file>`（照片与签名文件）

运行测试：`npm test`（32 个接口用例，覆盖权限、签到留痕、隐私隔离与图片校验）。

## 数据备份

业务数据与留痕文件都在 `server/data/` 下：

- `server/data/eduhub.db`（含 WAL 文件）—— 所有业务数据
- `server/data/uploads/` —— 课堂照片与签名图片
- `server/data/.jwt_secret` —— 自动生成的登录密钥

备份整个 `server/data/` 目录即可；Docker 部署时该目录已挂载为数据卷。

## Roadmap

- [x] 签到拍照 + 手写签名留痕
- [x] 桌面端 / 手机端双界面
- [ ] 课表月视图与导出
- [ ] 学生请假申请与消息通知
- [ ] 课时费/课酬统计
- [ ] 管理员审批注册与多机构支持
- [ ] uni-app 原生客户端
