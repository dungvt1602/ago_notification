# syntax=docker/dockerfile:1
# Backend NestJS (Express) — 3 stage: deps -> build -> runtime.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
# prisma.config.ts đọc DIRECT_URL khi generate (không kết nối DB) -> giá trị giả lúc build.
ENV DIRECT_URL=postgresql://build:build@localhost:5432/build
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=4000
RUN apk add --no-cache tini curl
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fs http://localhost:4000/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/main.js"]
