import { Injectable, Logger } from '@nestjs/common';
import { renderTemplate, renderBodyParams } from '@core/lib/placeholders';
import { sendQuotationMessage, uploadWhatsAppMedia, isDryRun } from '@core/lib/whatsapp';
import { channelTypeOf, isWhatsApp } from '@core/lib/channelType';
import { detectPhoneType } from '@core/lib/phoneType';
import { previewSchema, confirmSchema, cancelSchema } from '@core/validation/send.schema';
import { actorFromRequest } from '@common/audit/audit.helpers';
import type { ReqLike } from '@core/http/reqLike';
import { ActivityService } from '../activity/activity.service';
import { TemplatesService } from '../templates/templates.service';
import { SendRepository } from './send.repository';
import { SendJobService } from './send-job.service';
import { QuotaService, type QuotaState } from './quota.service';

const MAX_RETRY = 3;
const QUEUE_DELAY_MS = 1000; // delay giữa các tin (như bot)
const QUOTA_RECHECK_EVERY = 50; // cứ 50 tin thì đếm lại hạn mức thật (chặn 2 worker cùng vượt)

// Tin bị kẹt "Đang gửi" quá lâu = tiến trình gửi chết giữa chừng (Render restart/deploy).
// KHÔNG tự gửi lại (có thể tin đã tới khách) — đánh Thất bại kèm lý do để người dùng tự quyết.
const STUCK_SENDING_MS = 15 * 60 * 1000;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function compactDateTime(d: Date): string {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const o: Record<string, string> = {};
  p.forEach((x) => (o[x.type] = x.value));
  return `${o.year}${o.month}${o.day}${o.hour}${o.minute}${o.second}`;
}

// Lọc khách đủ điều kiện nhận (mirror bot: STATUS=ACTIVE + RECEIVE_QUOTATION=YES).
function eligible<T extends { status: string; receiveQuotation: boolean }>(customers: T[]): T[] {
  return customers.filter((c) => (c.status || '').toUpperCase() === 'ACTIVE' && c.receiveQuotation);
}

// Infinity không JSON hoá được -> trả null cho client.
const fin = (n: number) => (Number.isFinite(n) ? n : null);

// Phân loại số điện thoại của danh sách khách (Việc 4) — dùng nhãn ĐÃ backfill (O(1)),
// chỉ parse lại khi chưa có để tránh chạy libphonenumber hàng nghìn lần mỗi lần xem trước.
function summarizePhones(
  customers: {
    whatsappPhone?: string | null;
    phone?: string | null;
    market?: string | null;
    phoneType?: string | null;
    waStatus?: string | null;
  }[],
) {
  const s = { mobile: 0, fixedLine: 0, ambiguous: 0, unknown: 0, noWhatsapp: 0 };
  for (const c of customers) {
    const t = c.phoneType || detectPhoneType(c.whatsappPhone || c.phone || '', c.market);
    if (t === 'MOBILE') s.mobile++;
    else if (t === 'FIXED_LINE') s.fixedLine++;
    else if (t === 'AMBIGUOUS') s.ambiguous++;
    else s.unknown++;
    if (c.waStatus === 'NO_WHATSAPP') s.noWhatsapp++;
  }
  return s;
}

@Injectable()
export class SendService {
  private readonly logger = new Logger(SendService.name);

  constructor(
    private readonly repo: SendRepository,
    private readonly activity: ActivityService,
    private readonly templates: TemplatesService,
    private readonly quota: QuotaService,
    private readonly sendJobs: SendJobService,
  ) {}

  // ---- Điều phối từ controller ----
  async preview(req: ReqLike, body: unknown) {
    const input = previewSchema.parse(body);
    const a = actorFromRequest(req);
    return this.previewSend({
      ...input,
      actor: { id: input.actor?.id ?? a.id, name: input.actor?.name ?? a.name },
    });
  }

  async confirm(req: ReqLike, body: unknown) {
    const input = confirmSchema.parse(body);
    const a = actorFromRequest(req);
    return this.confirmSend({
      ...input,
      actor: { id: input.actor?.id ?? a.id, name: input.actor?.name ?? a.name },
    });
  }

  async cancel(req: ReqLike, body: unknown) {
    return this.cancelSend({ ...cancelSchema.parse(body), actor: actorFromRequest(req) });
  }

  process() {
    return this.processNextBatch();
  }

  listJobs() {
    return this.sendJobs.listSendJobs();
  }

  // ---- Truy vấn lệnh gửi (cho controller batches) ----
  listBatches() {
    return this.repo.findBatches();
  }

  getBatch(id: string) {
    return this.repo.findBatchWithJobs(BigInt(id));
  }

  // ---- 1) PREVIEW: tạo lệnh gửi, xem trước nội dung + danh sách khách ----
  async previewSend(params: {
    templateId: bigint | number | string;
    channelId?: bigint | number | string | null;
    actor?: { id?: bigint | number | string | null; name?: string | null };
  }) {
    const template = await this.repo.findTemplateForPreview(BigInt(params.templateId));
    if (!template) throw new Error('Không tìm thấy template.');
    if (!template.quotation)
      throw new Error(
        'Template này chưa gắn báo giá nên chưa gửi được. Mở chi tiết template để gắn báo giá.',
      );

    const recipients = eligible(template.customerLinks.map((l) => l.customer));
    if (recipients.length === 0) {
      throw new Error(
        'Template này chưa có khách hàng đủ điều kiện nhận. Khách cần đang hoạt động và bật nhận báo giá.',
      );
    }

    // Kênh: ưu tiên channelId truyền vào, sau đó kênh mặc định của template.
    const channelId = params.channelId ? BigInt(params.channelId) : template.channelId;
    const channel = channelId ? await this.repo.findChannel(channelId) : null;

    const code = 'BG' + compactDateTime(new Date());
    const batch = await this.repo.createBatch({
      code,
      quotationId: template.quotationId!,
      templateId: template.id,
      channelId: channel?.id ?? null,
      createdBy: params.actor?.id != null ? BigInt(params.actor.id) : null,
      recipientCount: recipients.length,
      status: 'PREVIEW',
      note: 'Đã tạo lệnh preview',
    });

    const sample = renderTemplate(
      template.body || '',
      template.quotation,
      recipients[0],
      template.quotation.items,
    );

    await this.activity.logActivity({
      userId: params.actor?.id ?? null,
      actorName: params.actor?.name ?? null,
      action: 'TAO_LENH_BAO_GIA',
      target: batch.code,
      result: 'SUCCESS',
      note: `${recipients.length} khách · template ${template.name}`,
    });

    // Hạn mức (Việc 2/3) + phân loại số (Việc 4) — cho màn xem trước hiển thị.
    const isWa = isWhatsApp(channel);
    const quota = isWa ? await this.quota.getQuotaState() : null;
    // Tin của CÁC LỆNH KHÁC đang xếp hàng phía trước (worker chạy FIFO theo id job) — phải cộng vào
    // ước lượng số ngày, nếu không màn xem trước báo ít ngày hơn thực tế.
    const queuedAhead = isWa ? await this.repo.countWaJobsPending() : 0;
    const phoneSummary = summarizePhones(recipients);

    const q = template.quotation;
    return {
      batch,
      channel,
      template: {
        id: template.id,
        name: template.name,
        body: template.body,
        productName: template.subject,
        createdAt: template.createdAt,
      },
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
        phone: c.whatsappPhone || c.phone || '',
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
      // Chế độ gửi giả hay gửi thật — phải hiện lên màn xem trước.
      dryRun: isDryRun(),
      phoneSummary,
    };
  }

  // ---- 2) CONFIRM: đẩy từng khách vào hàng đợi ----
  async confirmSend(params: {
    batchId: bigint | number | string;
    actor?: { id?: bigint | number | string | null; name?: string | null };
  }) {
    const batch = await this.repo.findBatchForConfirm(BigInt(params.batchId));
    if (!batch) throw new Error('Không tìm thấy lệnh gửi.');
    if (!batch.template.quotation) throw new Error('Template này chưa gắn báo giá nên chưa gửi được.');

    const recipients = eligible(batch.template.customerLinks.map((l) => l.customer));
    if (recipients.length === 0) throw new Error('Template này chưa có khách hàng đủ điều kiện nhận.');

    const channel = batch.channel || batch.template.channel;
    const channelType = channelTypeOf(channel);

    // KHOÁ lệnh bằng 1 câu UPDATE có điều kiện: bấm "Xác nhận" 2 lần thì chỉ 1 request đổi được
    // PREVIEW -> QUEUED; request kia nhận count=0 và dừng, không tạo bộ tin thứ 2.
    const lock = await this.repo.lockPreviewBatch(batch.id);
    if (lock.count === 0)
      throw new Error(`Lệnh ${batch.code} đã được xác nhận hoặc không còn ở bước xem trước.`);

    try {
      await this.repo.createJobs(
        recipients.map((c) => ({
          batchId: batch.id,
          customerId: c.id,
          toName: c.name,
          toPhone: c.whatsappPhone || c.phone || '',
          channel: channelType,
          message: renderTemplate(
            batch.template.body || '',
            batch.template.quotation!,
            c,
            batch.template.quotation!.items,
          ),
          status: 'QUEUED',
        })),
      );
    } catch (err) {
      await this.repo.revertBatchToPreview(batch.id);
      throw err;
    }

    await this.repo.markBatchQueued(batch.id, `Đã đưa ${recipients.length} khách vào hàng đợi`);

    await this.activity.logActivity({
      userId: params.actor?.id ?? null,
      actorName: params.actor?.name ?? null,
      action: 'XAC_NHAN_GUI',
      target: batch.code,
      result: 'SUCCESS',
      note: `Queue ${recipients.length} khách qua ${channelType}`,
    });

    return { batchId: batch.id, code: batch.code, queued: recipients.length };
  }

  // ---- 3) CANCEL ----
  async cancelSend(params: {
    batchId: bigint | number | string;
    actor?: { id?: string | null; name?: string | null };
  }) {
    const id = BigInt(params.batchId);
    // Huỷ luôn job CHƯA gửi (QUEUED/HOLD) -> FAILED, đẩy retryCount lên trần để worker không nhặt lại.
    // KHÔNG đụng SENDING (tin đã bay) và SENT/DELIVERED/READ (đã xong).
    const [, batch] = await this.repo.cancelBatchTransaction(id, MAX_RETRY);
    await this.activity.logActivity({
      userId: params.actor?.id ?? null,
      actorName: params.actor?.name ?? null,
      action: 'HUY_LENH',
      target: batch.code,
      result: 'SUCCESS',
    });
    return { batchId: batch.id, code: batch.code };
  }

  private async releaseStuckJobs() {
    await this.repo.failStuckSending(
      new Date(Date.now() - STUCK_SENDING_MS),
      MAX_RETRY,
      'Kẹt ở trạng thái Đang gửi quá 15 phút (tiến trình gửi bị ngắt giữa chừng) — không rõ tin đã tới khách chưa nên KHÔNG tự gửi lại.',
    );
  }

  // Nhả job HOLD (Chờ hạn mức) thành QUEUED theo FIFO, tối đa `limit` job.
  private async releaseWaHolds(limit: number): Promise<number> {
    const take = Number.isFinite(limit) ? Math.max(1, Math.ceil(limit)) : 10000;
    const ids = await this.repo.findHoldIdsFifo(take);
    if (!ids.length) return 0;
    await this.repo.queueJobsByIds(ids.map((i) => i.id));
    return ids.length;
  }

  // Giữ phần còn lại của 1 lệnh WHATSAPP (QUEUED + retryable FAILED) thành HOLD khi hết hạn mức giữa chừng.
  private async holdQueuedJobsOfBatch(batchId: bigint): Promise<number> {
    const r = await this.repo.holdRetryableOfBatch(batchId, MAX_RETRY);
    return r.count;
  }

  // ---- 4) WORKER: xử lý batch tiếp theo trong hàng đợi ----
  async processNextBatch() {
    await this.releaseStuckJobs();

    // ---- Hạn mức WhatsApp (Việc 3): điều chỉnh hàng đợi TRƯỚC khi chọn job. ----
    // Chỉ áp dụng WHATSAPP. Worker poll mỗi 8s, đa số lượt hàng đợi RỖNG nên hỏi 2 câu findFirst
    // (rẻ) trước, có job mới đụng tới hạn mức (COUNT DISTINCT).
    const [waQueuedRow, waHoldRow] = await Promise.all([
      this.repo.findFirstWaJobByStatus('QUEUED'),
      this.repo.findFirstWaJobByStatus('HOLD'),
    ]);
    let quota: QuotaState | null = null;
    if (waQueuedRow || waHoldRow) {
      quota = await this.quota.getQuotaState();
      if (quota.remaining <= 0) {
        // Hết chỗ: mọi job WHATSAPP đang QUEUED -> HOLD (hiện "Chờ hạn mức").
        if (waQueuedRow) {
          await this.repo.holdAllQueuedWa();
        }
      } else if (!waQueuedRow && waHoldRow) {
        // Còn chỗ và không còn job WHATSAPP QUEUED phía trước -> nhả HOLD thành QUEUED (FIFO).
        await this.releaseWaHolds(quota.remaining);
      }
    }

    const nextJob = await this.repo.findNextJob(MAX_RETRY);
    if (!nextJob) return { processed: false as const };

    const batch = await this.repo.findBatchForSending(nextJob.batchId);
    if (!batch) return { processed: false as const };

    await this.repo.markBatchSending(batch.id);

    const channel = batch.channel || batch.template.channel;
    const tpl = batch.template;
    // Dùng CHUNG isDryRun() với lớp gửi tin để upload ảnh và gửi tin không chạy ở hai chế độ khác nhau.
    const dryRun = isDryRun();

    // Ảnh header = ảnh do người dùng upload vào template. CHỈ check metadata (không kéo 2MB bytes
    // mỗi vòng — từng cháy 11.6GB egress/ngày).
    const includeImage = await this.templates.hasTemplateImage(tpl.id);
    // sendAsText bật -> ép đi đường text thường, bỏ qua template Meta.
    const useWaTemplate = isWhatsApp(channel) && !!tpl.waTemplateName && !tpl.sendAsText;
    let mediaId = batch.mediaId || '';

    // Upload ảnh lên WhatsApp 1 lần/lệnh — bytes chỉ tải ĐÚNG LÚC NÀY (khi chưa có mediaId).
    if (useWaTemplate && includeImage && !mediaId && !dryRun) {
      try {
        const token = process.env[channel?.apiKeyEnv || 'WHATSAPP_TOKEN_MAIN'];
        const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || channel?.accountId || '';
        const tplImage = token && phoneNumberId ? await this.templates.getTemplateImage(tpl.id) : null;
        if (token && phoneNumberId && tplImage) {
          const bytes = new Uint8Array(tplImage.data).buffer;
          mediaId = await uploadWhatsAppMedia({
            token,
            phoneNumberId,
            bytes,
            mime: tplImage.mime,
            filename: `${batch.code}`,
          });
          await this.repo.saveBatchMediaId(batch.id, mediaId);
        }
      } catch (err) {
        this.logger.error('[sendWorker] upload ảnh lỗi:', err instanceof Error ? err.stack : String(err));
      }
    }

    // Mẫu Meta BẮT BUỘC có ảnh header mà không có mediaId -> gửi kiểu gì cũng bị Meta từ chối #132012.
    // Fail cả lệnh với lỗi RÕ RÀNG thay vì bắn từng tin chắc chắn rớt.
    if (useWaTemplate && !dryRun && tpl.waImage && !mediaId) {
      const reason = includeImage
        ? `Mẫu Meta "${tpl.waTemplateName}" yêu cầu ảnh header nhưng không tải/upload được ảnh của template — kiểm tra ảnh trong template và cấu hình Storage.`
        : `Mẫu Meta "${tpl.waTemplateName}" yêu cầu ảnh header nhưng template chưa upload ảnh — vào Template > sửa > tải ảnh lên rồi gửi lại.`;
      await this.repo.failRetryableOfBatch(batch.id, MAX_RETRY, reason);
      await this.repo.markBatchPartialFailed(batch.id, reason);
      return {
        processed: true as const,
        code: batch.code,
        sent: 0,
        failed: 1,
        finalStatus: 'PARTIAL_FAILED',
      };
    }

    const jobs = await this.repo.findRetryableJobsOfBatch(batch.id, MAX_RETRY);

    let sent = 0;
    let failed = 0;
    // Hạn mức: chỉ đếm cho kênh WHATSAPP. Mặc định phải là WHATSAPP giống confirmSend (lệnh không gắn
    // kênh vẫn đi thật qua WhatsApp) — nếu không sẽ gửi KHÔNG giới hạn dù vẫn trừ hạn mức Meta.
    const isWa = isWhatsApp(channel);
    // Lệnh WhatsApp mà chưa nạp hạn mức (vd. chỉ còn job FAILED chờ gửi lại) thì nạp ngay tại đây.
    if (isWa && !quota) quota = await this.quota.getQuotaState();
    let budget = isWa && quota ? quota.remaining : Infinity;
    let held = 0;

    for (const job of jobs) {
      if (Number.isFinite(budget) && budget <= 0) {
        held = await this.holdQueuedJobsOfBatch(batch.id);
        break;
      }
      await delay(QUEUE_DELAY_MS);
      // GIỮ CHỖ tin trước khi gửi: nếu 2 tiến trình cùng chạy lệnh này (worker nền + cron) thì chỉ
      // tiến trình đổi được trạng thái (count=1) mới gửi; bên kia bỏ qua -> không gửi trùng.
      const claim = await this.repo.claimJob(job.id, MAX_RETRY);
      if (claim.count === 0) continue;

      if (!job.toPhone) {
        failed++;
        await this.repo.failJobNoPhone(job.id, job.retryCount + 1);
        continue;
      }

      try {
        const r = await sendQuotationMessage({
          channelType: job.channel,
          apiKeyEnv: channel?.apiKeyEnv,
          accountId: channel?.accountId,
          toPhone: job.toPhone,
          toName: job.toName,
          text: job.message || '',
          wa: useWaTemplate
            ? {
                templateName: tpl.waTemplateName!,
                language: tpl.waLanguage,
                mediaId,
                includeImage,
                bodyParams: tpl.quotation
                  ? renderBodyParams(
                      tpl.waBodyParams,
                      tpl.quotation,
                      { name: job.toName || '' },
                      tpl.quotation.items,
                    )
                  : job.toName
                    ? [{ value: job.toName }]
                    : [],
                hasFlowButton: tpl.waFlow,
              }
            : null,
        });
        sent++;
        if (Number.isFinite(budget)) budget--;
        await this.repo.markJobSent(job.id, r.messageId);
        // Hai tiến trình cùng gửi (worker nền + cron kéo) tự tính budget từ cùng đầu vào nên có thể vượt
        // gấp đôi. Cứ QUOTA_RECHECK_EVERY tin thì đếm lại THẬT (force, bỏ cache 30s). Đặt SAU khi ghi
        // SENT + sentAt để tin vừa gửi đã vào sổ. Lấy THẲNG số đếm mới (không min với budget cục bộ):
        // hạn mức Meta tính theo KHÁCH duy nhất, budget cục bộ trừ theo từng TIN.
        if (isWa && sent % QUOTA_RECHECK_EVERY === 0) {
          const fresh = await this.quota.getQuotaState(true);
          budget = fresh.remaining;
        }
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        const rc = job.retryCount + 1;
        // Lỗi VĨNH VIỄN của Meta (retry cũng vô ích) -> FAILED luôn, khỏi quay vòng hàng đợi.
        const permanent =
          /131049|131026|131047|131000|130472|132\d{3}|\(#100\)|Parameter name is missing/.test(msg);
        // 131026 = Message Undeliverable — tín hiệu YẾU, chỉ đánh dấu waStatus để cảnh báo trên UI,
        // KHÔNG tự loại khách khỏi danh sách gửi.
        if (/131026/.test(msg) && job.customerId != null) {
          await this.repo.markCustomerNoWhatsapp(job.customerId).catch(() => {}); // không để lỗi đánh dấu làm hỏng luồng gửi
        }
        await this.repo.updateJobAfterError(job.id, {
          status: permanent || rc >= MAX_RETRY ? 'FAILED' : 'QUEUED',
          error: msg,
          // Lỗi vĩnh viễn: đẩy retryCount lên trần luôn — nếu không câu chọn job (FAILED AND retryCount<3)
          // vẫn nhặt lại và bắn thêm 2 lần vô ích.
          retryCount: permanent ? Math.max(rc, MAX_RETRY) : rc,
        });
      }
    }

    // Tính trạng thái cuối của batch (kể cả job HOLD đang chờ hạn mức).
    const remaining = await this.repo.countJobsOfBatchByStatuses(batch.id, ['QUEUED', 'SENDING', 'HOLD']);
    const failedCount = await this.repo.countJobsOfBatchByStatus(batch.id, 'FAILED');
    const finalStatus = remaining > 0 ? 'QUEUED' : failedCount > 0 ? 'PARTIAL_FAILED' : 'SENT';
    const holdNote = held > 0 ? ` · ${held} khách chờ hạn mức` : '';

    await this.repo.finishBatch(batch.id, finalStatus, `Đã gửi ${sent}, lỗi ${failed}${holdNote}`);

    await this.activity.logActivity({
      action: 'GUI_WHATSAPP_QUEUE',
      target: batch.code,
      result: failed > 0 ? 'FAILED' : 'SUCCESS',
      note: `sent ${sent}, failed ${failed}, status ${finalStatus}`,
    });

    return { processed: true as const, code: batch.code, sent, failed, finalStatus };
  }
}
