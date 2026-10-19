import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Cấu hình cho Prisma CLI (migrate, introspect, studio).
// Prisma 7 không tự đọc .env -> "dotenv/config" ở trên nạp biến môi trường.
export default defineConfig({
  schema: "prisma/schema.prisma",
  // Migrate/introspect cần kết nối TRỰC TIẾP (không qua pgbouncer) -> dùng DIRECT_URL.
  datasource: {
    url: env("DIRECT_URL"),
  },
  migrations: {
    // Lệnh seed dữ liệu mẫu (dùng khi chạy `prisma migrate reset`).
    seed: "tsx prisma/seed.ts",
  },
});
