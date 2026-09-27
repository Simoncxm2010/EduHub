# ---- 前端构建 ----
FROM node:24-alpine AS webbuild
WORKDIR /app
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --no-fund --no-audit
COPY web ./web
RUN cd web && npm run build

# ---- 运行镜像 ----
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --no-fund --no-audit
COPY server ./server
COPY --from=webbuild /app/web/dist ./web/dist

# 数据库与密钥持久化目录
VOLUME ["/app/server/data"]
EXPOSE 8787

CMD ["node", "server/src/index.js"]
