import { prisma } from "@core/db/prisma";
import { renderTemplate, renderBodyParams } from "@core/lib/placeholders";
import { sendQuotationMessage, uploadWhatsAppMedia, isDryRun } from "@core/lib/whatsapp";
import { getTemplateImage, hasTemplateImage } from "@core/services/templateService";
import { logActivity } from "@core/services/activityService";
import { getQuotaState, type QuotaState } from "@core/services/quotaService";
import { channelTypeOf, isWhatsApp } from "@core/lib/channelType";
import { detectPhoneType } from "@core/lib/phoneType";

const MAX_RETRY = 3;
const QUEUE_DELAY_MS = 1000; // delay giữa các tin (như bot)
const QUOTA_RECHECK_EVERY = 50; // cứ 50 tin thì đếm lại hạn mức thật (chặn 2 worker cùng vượt)

// ---- Truy vấn lệnh gửi (cho controller batches) ----
export function listBatches() {
  return prisma.sendBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      quotation: { select: { code: true, title: true } },
      template: { select: { name: true } },
      channel: { select: { name: true, type: true } },
      _count: { select: { jobs: true } },
    },
  });
}

export function getBatch(id: string) {
  return prisma.sendBatch.findUnique({
    where: { id: BigInt(id) },
    include: {
      quotation: { select: { code: true, title: true } },
      template: { select: { name: true } },
      channel: { select: { name: true, type: true } },
      jobs: { orderBy: { id: "asc" } },
    },
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function compactDateTime(d: Date): string {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const o: Record<string, string> = {};
  p.forEach((x) => (o[x.type] = x.value));
  return `${o.year}${o.month}${o.day}${o.hour}${o.minute}${o.second}`;
}

// Lọc khách đủ điều kiện nhận (mirror bot: STATUS=ACTIVE + RECEIVE_QUOTATION=YES).
function eligible<T extends { status: string; receiveQuotation: boolean }>(customers: T[]): T[] {
  return customers.filter(
    (c) => (c.status || "").toUpperCase() === "ACTIVE" && c.receiveQuotation,
  );
}

// Infinity không JSON hoá được -> trả null cho client.
const fin = (n: number) => (Number.isFinite(n) ? n : null);

// Phân loại số điện thoại của danh sách khách (Việc 4) — để màn xem trước báo
// "trong N khách có X số máy bàn, Y số không có WhatsApp".
// HIỆU NĂNG: dùng nhãn ĐÃ backfill (c.phoneType, O(1)); chỉ parse lại khi chưa có (dữ liệu cũ
// chưa backfill). Tránh chạy libphonenumber hàng nghìn lần mỗi lần mở xem trước.
function summarizePhones(
  customers: { whatsappPhone?: string | null; phone?: string | null; market?: string | null; phoneType?: string | null; waStatus?: string | null }[],
) {
  const s = { mobile: 0, fixedLine: 0, ambiguous: 0, unknown: 0, noWhatsapp: 0 };
  for (const c of customers) {
    const t = c.phoneType || detectPhoneType(c.whatsappPhone || c.phone || "", c.market);
    if (t === "MOBILE") s.mobile++;
    else if (t === "FIXED_LINE") s.fixedLine++;
    else if (t === "AMBIGUOUS") s.ambiguous++;
    else s.unknown++;
    if (c.waStatus === "NO_WHATSAPP") s.noWhatsapp++;
  }
  return s;
}

// ---- 1) PREVIEW: tạo lệnh gửi, xem trước nội dung + danh sách khách ----
export async function previewSend(params: {
  templateId: bigint | number | string;
  channelId?: bigint | number | string | null;
  actor?: { id?: bigint | number | string | null; name?: string | null };
}) {
  const template = await prisma.template.findUnique({
    where: { id: BigInt(params.templateId) },
    include: {
      quotation: { include: { items: { orderBy: { no: "asc" } } } },
      channel: true,
      customerLinks: { include: { customer: true } },
    },
  });
  if (!template) throw new Error("Không tìm thấy template.");
  if (!template.quotation) throw new Error("Template này chưa gắn báo giá nên chưa gửi được. Mở chi tiết template để gắn báo giá.");

  const recipients = eligible(template.customerLinks.map((l) => l.customer));
  if (recipients.length === 0) {
    throw new Error("Template này chưa có khách hàng đủ điều kiện nhận. Khách cần đang hoạt động và bật nhận báo giá.");
  }

  // Kênh: ưu tiên channelId truyền vào, sau đó kênh mặc định của template.
  const channelId = params.channelId ? BigInt(params.channelId) : template.channelId;
  const channel = channelId
    ? await prisma.channel.findUnique({ where: { id: channelId } })
    : null;

  const code = "BG" + compactDateTime(new Date());
  const batch = await prisma.sendBatch.create({
    data: {
      code,
      quotationId: template.quotationId!,
      templateId: template.id,
      channelId: channel?.id ?? null,
      createdBy: params.actor?.id != null ? BigInt(params.actor.id) : null,
      recipientCount: recipients.length,
      status: "PREVIEW",
      note: "Đã tạo lệnh preview",
    },
  });

  const sample = renderTemplate(template.body || "", template.quotation, recipients[0], template.quotation.items);

  await logActivity({
    userId: params.actor?.id ?? null,
    actorName: params.actor?.name ?? null,
    action: "TAO_LENH_BAO_GIA",
    target: batch.code,
    result: "SUCCESS",
    note: `${recipients.length} khách · template ${template.name}`,
  });

  // Hạn mức (Việc 2/3) + phân loại số (Việc 4) — cho màn xem trước hiển thị.
  const isWa = isWhatsApp(channel);
  const quota = isWa ? await getQuotaState() : null;
  // Tin của CÁC LỆNH KHÁC đang xếp hàng phía trước. Worker chạy FIFO theo id job nên lệnh mới
  // phải đợi hết chỗ tồn đọng; không cộng số này vào thì màn xem trước báo số ngày ÍT HƠN thực tế
  // và người dùng tưởng gửi xong sớm hơn nhiều.
  const queuedAhead = isWa
    ? await prisma.sendJob.count({
        where: { channel: "WHATSAPP", status: { in: ["QUEUED", "SENDING", "HOLD"] } },
      })
    : 0;
  const phoneSummary = summarizePhones(recipients);

  const q = template.quotation;
  return {
    batch,
    channel,
    template: { id: template.id, name: template.name, body: template.body, productName: template.subject, createdAt: template.createdAt },
    quotation: {
      code: q.code,
      title: q.title,
      market: q.market,
      currency: q.currency,
      totalAmount: q.totalAmount,
      validUntil: q.validUntil,
    },
    items: q.items.map((it) => ({
      no: it.no,
      product: it.product,
      packing: it.packing,
      unit: it.unit,
      quantity: it.quantity,
      price: it.price,
    })),
    sample,
    recipients: recipients.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.whatsappPhone || c.phone || "",
    })),
    quota: quota
      ? {
          qualityRating: quota.qualityRating,
          limit: fin(quota.limit),
          safeLimit: fin(quota.safeLimit),
          used24h: quota.used24h,
          remaining: fin(quota.remaining),
          // Ước lượng phải tính CẢ phần tồn đọng phía trước, không chỉ riêng lệnh này.
          daysNeeded:
            Number.isFinite(quota.safeLimit) && quota.safeLimit > 0
              ? Math.ceil((recipients.length + queuedAhead) / quota.safeLimit)
              : null,
          queuedAhead,
          limitUnknown: quota.limitUnknown,
        }
      : null,
    // Đang ở chế độ gửi giả hay gửi thật — phải hiện lên màn xem trước, nếu không người dùng
    // bấm Gửi rồi thấy "Đã gửi 8.000" mà thực tế không tin nào rời máy.
    dryRun: isDryRun(),
    phoneSummary,
  };
}

// ---- 2) CONFIRM: đẩy từng khách vào hàng đợi ----
export async function confirmSend(params: {
  batchId: bigint | number | string;
  actor?: { id?: bigint | number | string | null; name?: string | null };
}) {
  const batch = await prisma.sendBatch.findUnique({
    where: { id: BigInt(params.batchId) },
    include: {
      channel: true,
      template: {
        include: {
          quotation: { include: { items: { orderBy: { no: "asc" } } } },
          channel: true,
          customerLinks: { include: { customer: true } },
        },
      },
    },
  });
  if (!batch) throw new Error("Không tìm thấy lệnh gửi.");
  if (!batch.template.quotation) throw new Error("Template này chưa gắn báo giá nên chưa gửi được.");

  const recipients = eligible(batch.template.customerLinks.map((l) => l.customer));
  if (recipients.length === 0) throw new Error("Template này chưa có khách hàng đủ điều kiện nhận.");

  const channel = batch.channel || batch.template.channel;
  const channelType = channelTypeOf(channel);

  // KHOÁ lệnh bằng 1 câu UPDATE có điều kiện: bấm "Xác nhận" 2 lần (hoặc mạng chậm bấm lại)
  // thì chỉ 1 request đổi được PREVIEW -> QUEUED; request kia nhận count=0 và dừng, không tạo
  // bộ tin thứ 2. Chỉ lệnh PREVIEW mới xác nhận được (xác nhận lại lệnh đã gửi = gửi trùng).
  const lock = await prisma.sendBatch.updateMany({
    where: { id: batch.id, status: "PREVIEW" },
    data: { status: "QUEUED" },
  });
  if (lock.count === 0) throw new Error(`Lệnh ${batch.code} đã được xác nhận hoặc không còn ở bước xem trước.`);

  try {
    await prisma.sendJob.createMany({
      data: recipients.map((c) => ({
        batchId: batch.id,
        customerId: c.id,
        toName: c.name,
        toPhone: c.whatsappPhone || c.phone || "",
        channel: channelType,
        message: renderTemplate(batch.template.body || "", batch.template.quotation!, c, batch.template.quotation!.items),
        status: "QUEUED",
      })),
      skipDuplicates: true, // chốt chặn cuối: unique (batch_id, customer_id)
    });
  } catch (err) {
    await prisma.sendBatch.update({ where: { id: batch.id }, data: { status: "PREVIEW" } });
    throw err;
  }

  await prisma.sendBatch.update({
    where: { id: batch.id },
    data: { status: "QUEUED", note: `Đã đưa ${recipients.length} khách vào hàng đợi` },
  });

  await logActivity({
    userId: params.actor?.id ?? null,
    actorName: params.actor?.name ?? null,
    action: "XAC_NHAN_GUI",
    target: batch.code,
    result: "SUCCESS",
    note: `Queue ${recipients.length} khách qua ${channelType}`,
  });

  return { batchId: batch.id, code: batch.code, queued: recipients.length };
}

// ---- 3) CANCEL ----
export async function cancelSend(params: { batchId: bigint | number | string; actor?: { id?: string | null; name?: string | null } }) {
  const id = BigInt(params.batchId);
  // Huỷ luôn job CHƯA gửi (QUEUED/HOLD) -> FAILED kèm lý do, đẩy retryCount lên trần để worker
  // không nhặt lại. KHÔNG đụng SENDING (tin đã bay) và SENT/DELIVERED/READ (đã xong).
  // Trước đây chỉ đổi batch sang CANCELLED -> job QUEUED vẫn bị worker gửi tiếp.
  const [, batch] = await prisma.$transaction([
    prisma.sendJob.updateMany({
      where: { batchId: id, status: { in: ["QUEUED", "HOLD"] } },
      data: {
        status: "FAILED",
        retryCount: MAX_RETRY,
        error: "Lệnh đã bị huỷ bởi người dùng.",
      },
    }),
    prisma.sendBatch.update({
      where: { id },
      data: { status: "CANCELLED", note: "Người dùng đã hủy lệnh." },
    }),
  ]);
  await logActivity({ userId: params.actor?.id ?? null, actorName: params.actor?.name ?? null, action: "HUY_LENH", target: batch.code, result: "SUCCESS" });
  return { batchId: batch.id, code: batch.code };
}

// Tin bị kẹt "Đang gửi" quá lâu = tiến trình gửi chết giữa chừng (Render restart/deploy).
// KHÔNG tự gửi lại (có thể tin đã tới khách) — đánh Thất bại kèm lý do để người dùng tự quyết.
const STUCK_SENDING_MS = 15 * 60 * 1000;
async function releaseStuckJobs() {
  await prisma.sendJob.updateMany({
    where: { status: "SENDING", updatedAt: { lt: new Date(Date.now() - STUCK_SENDING_MS) } },
    data: {
      status: "FAILED",
      retryCount: MAX_RETRY,
      error: "Kẹt ở trạng thái Đang gửi quá 15 phút (tiến trình gửi bị ngắt giữa chừng) — không rõ tin đã tới khách chưa nên KHÔNG tự gửi lại.",
    },
  });
}

// Nhả job HOLD (Chờ hạn mức) thành QUEUED theo FIFO, tối đa `limit` job.
async function releaseWaHolds(limit: number): Promise<number> {
  const take = Number.isFinite(limit) ? Math.max(1, Math.ceil(limit)) : 10000;
  const ids = await prisma.sendJob.findMany({
    where: { status: "HOLD", channel: "WHATSAPP" },
    orderBy: { id: "asc" },
    take,
    select: { id: true },
  });
  if (!ids.length) return 0;
  await prisma.sendJob.updateMany({ where: { id: { in: ids.map((i) => i.id) } }, data: { status: "QUEUED" } });
  return ids.length;
}

// Giữ phần còn lại của 1 lệnh WHATSAPP (QUEUED + retryable FAILED) thành HOLD khi hết hạn mức giữa chừng.
async function holdQueuedJobsOfBatch(batchId: bigint): Promise<number> {
  const r = await prisma.sendJob.updateMany({
    where: { batchId, OR: [{ status: "QUEUED" }, { status: "FAILED", retryCount: { lt: MAX_RETRY } }] },
    data: { status: "HOLD" },
  });
  return r.count;
}

// ---- 4) WORKER: xử lý batch tiếp theo trong hàng đợi ----
export async function processNextBatch() {
  await releaseStuckJobs();

  // ---- Hạn mức WhatsApp (Việc 3): điều chỉnh hàng đợi TRƯỚC khi chọn job. ----
  // Meta không cho đọc "đã dùng bao nhiêu" -> app tự đếm (quotaService). Chỉ áp dụng WHATSAPP;
  // Telegram/Zalo không bị ảnh hưởng bởi hạn mức Meta.
  //
  // HIỆU NĂNG: worker poll mỗi 8s cả ngày, đa số lượt hàng đợi RỖNG. Trước đây lượt nào cũng gọi
  // getQuotaState() -> COUNT(DISTINCT) trên send_jobs chạy 24/7 vô ích. Giờ hỏi 2 câu "có job nào
  // không" (findFirst, dừng ngay ở dòng đầu, có index status) rồi mới đụng tới hạn mức.
  const [waQueuedRow, waHoldRow] = await Promise.all([
    prisma.sendJob.findFirst({ where: { status: "QUEUED", channel: "WHATSAPP" }, select: { id: true } }),
    prisma.sendJob.findFirst({ where: { status: "HOLD", channel: "WHATSAPP" }, select: { id: true } }),
  ]);
  let quota: QuotaState | null = null;
  if (waQueuedRow || waHoldRow) {
    quota = await getQuotaState();
    if (quota.remaining <= 0) {
      // Hết chỗ: mọi job WHATSAPP đang QUEUED -> HOLD (hiện "Chờ hạn mức").
      if (waQueuedRow) {
        await prisma.sendJob.updateMany({
          where: { status: "QUEUED", channel: "WHATSAPP" },
          data: { status: "HOLD" },
        });
      }
    } else if (!waQueuedRow && waHoldRow) {
      // Còn chỗ và không còn job WHATSAPP QUEUED phía trước -> nhả HOLD thành QUEUED (FIFO).
      await releaseWaHolds(quota.remaining);
    }
  }

  const nextJob = await prisma.sendJob.findFirst({
    where: {
      OR: [{ status: "QUEUED" }, { status: "FAILED", retryCount: { lt: MAX_RETRY } }],
    },
    orderBy: { id: "asc" },
  });
  if (!nextJob) return { processed: false as const };

  const batch = await prisma.sendBatch.findUnique({
    where: { id: nextJob.batchId },
    include: {
      channel: true,
      template: {
        include: { channel: true, quotation: { include: { items: { orderBy: { no: "asc" } } } } },
      },
    },
  });
  if (!batch) return { processed: false as const };

  await prisma.sendBatch.update({ where: { id: batch.id }, data: { status: "SENDING" } });

  const channel = batch.channel || batch.template.channel;
  const tpl = batch.template;
  // Dùng CHUNG isDryRun() với lớp gửi tin. Trước đây chỗ này tự so sánh biến môi trường theo kiểu
  // riêng — hai nơi lệch nhau thì upload ảnh và gửi tin có thể chạy ở hai chế độ khác nhau.
  const dryRun = isDryRun();

  // Ảnh header = ảnh do người dùng upload vào template (giống bot). Có ảnh thì gửi kèm.
  // CHỈ check metadata (không kéo 2MB bytes mỗi vòng — từng cháy 11.6GB egress/ngày).
  const includeImage = await hasTemplateImage(tpl.id);
  // sendAsText bật -> ép đi đường text thường (như commit cũ), bỏ qua template Meta.
  const useWaTemplate =
    isWhatsApp(channel) && !!tpl.waTemplateName && !tpl.sendAsText;
  let mediaId = batch.mediaId || "";

  // Upload ảnh lên WhatsApp 1 lần/lệnh — bytes chỉ tải ĐÚNG LÚC NÀY (khi chưa có mediaId).
  if (useWaTemplate && includeImage && !mediaId && !dryRun) {
    try {
      const token = process.env[channel?.apiKeyEnv || "WHATSAPP_TOKEN_MAIN"];
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || channel?.accountId || "";
      const tplImage = token && phoneNumberId ? await getTemplateImage(tpl.id) : null;
      if (token && phoneNumberId && tplImage) {
        const bytes = new Uint8Array(tplImage.data).buffer;
        mediaId = await uploadWhatsAppMedia({ token, phoneNumberId, bytes, mime: tplImage.mime, filename: `${batch.code}` });
        await prisma.sendBatch.update({ where: { id: batch.id }, data: { mediaId } });
      }
    } catch (err) {
      console.error("[sendWorker] upload ảnh lỗi:", err);
    }
  }

  // Mẫu Meta BẮT BUỘC có ảnh header (waImage đồng bộ từ Meta) mà không có mediaId
  // (chưa upload ảnh vào template, hoặc tải/upload ảnh lỗi) -> gửi kiểu gì cũng bị Meta
  // từ chối #132012. Fail cả lệnh với lỗi RÕ RÀNG thay vì bắn từng tin chắc chắn rớt.
  if (useWaTemplate && !dryRun && tpl.waImage && !mediaId) {
    const reason = includeImage
      ? `Mẫu Meta "${tpl.waTemplateName}" yêu cầu ảnh header nhưng không tải/upload được ảnh của template — kiểm tra ảnh trong template và cấu hình Storage.`
      : `Mẫu Meta "${tpl.waTemplateName}" yêu cầu ảnh header nhưng template chưa upload ảnh — vào Template > sửa > tải ảnh lên rồi gửi lại.`;
    await prisma.sendJob.updateMany({
      where: { batchId: batch.id, OR: [{ status: "QUEUED" }, { status: "FAILED", retryCount: { lt: MAX_RETRY } }] },
      data: { status: "FAILED", error: reason, retryCount: MAX_RETRY },
    });
    await prisma.sendBatch.update({ where: { id: batch.id }, data: { status: "PARTIAL_FAILED", note: reason } });
    return { processed: true as const, code: batch.code, sent: 0, failed: 1, finalStatus: "PARTIAL_FAILED" };
  }

  const jobs = await prisma.sendJob.findMany({
    where: {
      batchId: batch.id,
      OR: [{ status: "QUEUED" }, { status: "FAILED", retryCount: { lt: MAX_RETRY } }],
    },
    orderBy: { id: "asc" },
  });

  let sent = 0;
  let failed = 0;
  // Hạn mức: chỉ đếm cho kênh WHATSAPP. budget = số chỗ còn lại lượt này.
  //
  // MẶC ĐỊNH PHẢI LÀ "WHATSAPP", GIỐNG confirmSend: confirmSend gán job.channel =
  // (channel?.type || "WHATSAPP"), nên lệnh KHÔNG gắn kênh vẫn đi thật qua WhatsApp. Trước đây
  // chỗ này mặc định chuỗi rỗng -> isWa=false -> budget=Infinity -> gửi KHÔNG giới hạn dù tin
  // vẫn trừ vào hạn mức Meta. Hai nơi phải cùng một mặc định.
  const isWa = isWhatsApp(channel);
  // Lệnh WhatsApp mà chưa nạp hạn mức (vd. chỉ còn job FAILED đang chờ gửi lại — retry cũng trừ
  // hạn mức Meta như tin mới) thì nạp ngay tại đây.
  if (isWa && !quota) quota = await getQuotaState();
  let budget = isWa && quota ? quota.remaining : Infinity;
  let held = 0;

  for (const job of jobs) {
    if (Number.isFinite(budget) && budget <= 0) {
      held = await holdQueuedJobsOfBatch(batch.id);
      break;
    }
    await delay(QUEUE_DELAY_MS);
    // GIỮ CHỖ tin trước khi gửi: danh sách `jobs` lấy 1 lần từ đầu, nếu 2 tiến trình cùng chạy lệnh
    // này (worker nền + cron gọi vào, hoặc 2 bản Render chồng nhau lúc deploy) thì cả 2 có cùng
    // danh sách. Chỉ tiến trình đổi được trạng thái (count=1) mới gửi; bên kia bỏ qua -> không gửi trùng.
    const claim = await prisma.sendJob.updateMany({
      where: { id: job.id, OR: [{ status: "QUEUED" }, { status: "FAILED", retryCount: { lt: MAX_RETRY } }] },
      data: { status: "SENDING" },
    });
    if (claim.count === 0) continue;

    if (!job.toPhone) {
      failed++;
      await prisma.sendJob.update({
        where: { id: job.id },
        data: { status: "FAILED", error: "Thiếu số điện thoại.", retryCount: job.retryCount + 1 },
      });
      continue;
    }

    try {
      const r = await sendQuotationMessage({
        channelType: job.channel,
        apiKeyEnv: channel?.apiKeyEnv,
        accountId: channel?.accountId,
        toPhone: job.toPhone,
        toName: job.toName,
        text: job.message || "",
        wa: useWaTemplate
          ? {
              templateName: tpl.waTemplateName!,
              language: tpl.waLanguage,
              mediaId,
              includeImage,
              bodyParams: tpl.quotation
                ? renderBodyParams(tpl.waBodyParams, tpl.quotation, { name: job.toName || "" }, tpl.quotation.items)
                : job.toName
                  ? [{ value: job.toName }]
                  : [],
              hasFlowButton: tpl.waFlow,
            }
          : null,
      });
      sent++;
      if (Number.isFinite(budget)) budget--;
      await prisma.sendJob.update({
        where: { id: job.id },
        data: { status: "SENT", messageId: r.messageId, error: null, sentAt: new Date() },
      });
      // HAI TIẾN TRÌNH CÙNG GỬI: worker nền (instrumentation.ts, poll 8s) và endpoint kéo
      // (/api/cron/process-sends, cron-job.org gọi mỗi phút) đều chạy vòng này. Mỗi bên tự tính
      // budget từ cùng một con số đầu vào -> cộng lại có thể vượt GẤP ĐÔI hạn mức mà không ai
      // hay. Cứ QUOTA_RECHECK_EVERY tin thì đếm lại THẬT (force, bỏ cache 30s) và chỉ cho budget
      // THẤP đi, nên mức vượt tối đa bị chặn ở ~QUOTA_RECHECK_EVERY tin thay vì cả tier.
      // Đặt SAU khi ghi SENT + sentAt, nếu không tin vừa gửi chưa vào sổ và bản đếm bị hụt 1.
      // Lấy THẲNG số đếm mới, không lấy min với budget cục bộ: hạn mức Meta tính theo KHÁCH duy
      // nhất trong 24h, còn budget cục bộ trừ theo TỪNG TIN. Gửi 2 template cho cùng một khách
      // trong ngày chỉ tốn 1 suất, nhưng budget cục bộ trừ 2 -> lấy min sẽ khoá nhầm và treo lệnh
      // dù hạn mức còn chỗ. Số đếm từ DB mới là sự thật, và nó đã gồm tin của worker kia.
      if (isWa && sent % QUOTA_RECHECK_EVERY === 0) {
        const fresh = await getQuotaState(true);
        budget = fresh.remaining;
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      const rc = job.retryCount + 1;
      // Lỗi VĨNH VIỄN của Meta (retry cũng vô ích) -> FAILED luôn, khỏi quay vòng hàng đợi:
      // 131049 chặn tin marketing, 131026 không giao được, 132xxx lỗi template, (#100) sai tham số...
      const permanent = /131049|131026|131047|131000|130472|132\d{3}|\(#100\)|Parameter name is missing/.test(msg);
      // 131026 = Message Undeliverable — là tín hiệu YẾU, KHÔNG chắc chắn "không có WhatsApp"
      // (còn do khách chưa nhận ToS / app WhatsApp quá cũ / frequency capping). Đánh dấu waStatus
      // để cảnh báo trên UI, KHÔNG tự loại khách khỏi danh sách gửi; người dùng sửa tay được.
      if (/131026/.test(msg) && job.customerId != null) {
        await prisma.customer
          .update({ where: { id: job.customerId }, data: { waStatus: "NO_WHATSAPP" } })
          .catch(() => {}); // không để lỗi đánh dấu làm hỏng luồng gửi
      }
      await prisma.sendJob.update({
        where: { id: job.id },
        data: {
          status: permanent || rc >= MAX_RETRY ? "FAILED" : "QUEUED",
          error: msg,
          // Lỗi vĩnh viễn: đẩy retryCount lên trần luôn — nếu chỉ set FAILED mà rc<3,
          // câu chọn job (FAILED AND retryCount<3) vẫn nhặt lại và bắn thêm 2 lần vô ích.
          retryCount: permanent ? Math.max(rc, MAX_RETRY) : rc,
        },
      });
    }
  }

  // Tính trạng thái cuối của batch (kể cả job HOLD đang chờ hạn mức).
  const remaining = await prisma.sendJob.count({
    where: { batchId: batch.id, status: { in: ["QUEUED", "SENDING", "HOLD"] } },
  });
  const failedCount = await prisma.sendJob.count({
    where: { batchId: batch.id, status: "FAILED" },
  });
  const finalStatus = remaining > 0 ? "QUEUED" : failedCount > 0 ? "PARTIAL_FAILED" : "SENT";
  const holdNote = held > 0 ? ` · ${held} khách chờ hạn mức` : "";

  await prisma.sendBatch.update({
    where: { id: batch.id },
    data: { status: finalStatus, note: `Đã gửi ${sent}, lỗi ${failed}${holdNote}` },
  });

  await logActivity({
    action: "GUI_WHATSAPP_QUEUE",
    target: batch.code,
    result: failed > 0 ? "FAILED" : "SUCCESS",
    note: `sent ${sent}, failed ${failed}, status ${finalStatus}`,
  });

  return { processed: true as const, code: batch.code, sent, failed, finalStatus };
}
