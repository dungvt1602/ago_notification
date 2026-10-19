import { prisma } from "@core/db/prisma";

// Job CHƯA kết thúc — dùng chung cho listSendJobs (luôn hiện) và cleanupSendJobs (không xoá).
const PENDING_JOB_STATUS = ["QUEUED", "SENDING", "HOLD"] as const;

// Danh sách log gửi từng khách (mới nhất trước) — `days` ngày gần nhất, CỘNG THÊM mọi tin chưa
// gửi xong dù tạo đã lâu.
// Kèm mã lệnh / template / báo giá để tra cứu "đã gửi cho khách nào, của báo giá nào".
export function listSendJobs(days = 3, limit = 3000) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return prisma.sendJob.findMany({
    // Tin CHƯA gửi xong thì LUÔN hiện, bất kể ngày tạo: lệnh lớn bị hạn mức chia nhỏ có thể chờ
    // cả tuần. Trước đây chỉ lọc theo createdAt nên sang ngày thứ 4 các tin "Chờ hạn mức" biến
    // mất khỏi màn hình trong khi DB vẫn giữ -> người dùng tưởng mất tin.
    where: { OR: [{ createdAt: { gte: since } }, { status: { in: [...PENDING_JOB_STATUS] } }] },
    orderBy: { createdAt: "desc" },
    take: limit,
    // CHỈ lấy cột màn Log gửi thật sự dùng. Trước đây trả nguyên bản ghi, gồm `message` = toàn
    // văn báo giá đã render cho TỪNG khách -> 3.000 dòng thành vài MB JSON mỗi lần mở màn,
    // trong khi giao diện không hiển thị trường đó ở đâu cả.
    select: {
      id: true,
      toName: true,
      toPhone: true,
      channel: true,
      status: true,
      messageId: true,
      error: true,
      sentAt: true,
      createdAt: true,
      customer: { select: { company: true } },
      batch: { select: { template: { select: { name: true } } } },
    },
  });
}

// Dọn log gửi — CHIA 2 LUẬT để không xoá job CHƯA gửi:
// (1) Job đã KẾT THÚC (SENT/DELIVERED/READ/FAILED) -> xoá sau `days` ngày (như cũ).
// (2) Job CHƯA kết thúc (QUEUED/SENDING/HOLD) quá 30 ngày -> đánh FAILED kèm lý do rõ ràng
//     (KHÔNG tự gửi lại), để lần dọn sau xoá. Chặn "job chờ hạn mức / chờ tới lượt" bị mất tin
//     âm thầm, đồng thời không để job zombie gửi mãi.
//     (SendBatch giữ nguyên, chỉ xóa chi tiết từng khách.)
const TERMINAL_JOB_STATUS = ["SENT", "DELIVERED", "READ", "FAILED"] as const;
const STALE_PENDING_DAYS = 30;

export async function cleanupSendJobs(days = 3) {
  const before = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const staleBefore = new Date(Date.now() - STALE_PENDING_DAYS * 24 * 60 * 60 * 1000);
  const [deleted, staleFailed] = await Promise.all([
    prisma.sendJob.deleteMany({
      where: { createdAt: { lt: before }, status: { in: [...TERMINAL_JOB_STATUS] } },
    }),
    prisma.sendJob.updateMany({
      where: { createdAt: { lt: staleBefore }, status: { notIn: [...TERMINAL_JOB_STATUS] } },
      data: {
        status: "FAILED",
        retryCount: 99, // chặn worker nhặt lại
        error: "Quá hạn chờ gửi (30 ngày) — chưa từng được gửi.",
      },
    }),
  ]);
  return deleted.count + staleFailed.count;
}

// Dọn lệnh XEM TRƯỚC bỏ dở. Mỗi lần bấm "Xem trước" là tạo 1 send_batch trạng thái PREVIEW;
// không bấm xác nhận thì nó nằm lại vĩnh viễn, không ai dọn — làm sai biểu đồ trạng thái lệnh
// trên Tổng quan và phình bảng dần.
//
// AN TOÀN: chỉ đụng batch vừa PREVIEW vừa KHÔNG CÓ job nào. Lệnh đã xác nhận luôn sinh job
// (confirmSend tạo job rồi mới đổi trạng thái), nên điều kiện `jobs: none` đảm bảo không bao giờ
// xoá nhầm một lệnh gửi thật.
export async function cleanupStalePreviewBatches(days = 1) {
  const before = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const r = await prisma.sendBatch.deleteMany({
    where: { status: "PREVIEW", createdAt: { lt: before }, jobs: { none: {} } },
  });
  return r.count;
}
