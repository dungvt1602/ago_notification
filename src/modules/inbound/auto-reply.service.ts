import { Injectable } from '@nestjs/common';
import { renderBodyParams } from '@core/lib/placeholders';
import { sendQuotationMessage, uploadWhatsAppMedia } from '@core/lib/whatsapp';
import { isDryRun } from '@core/lib/sendMode';
import { TemplatesService } from '../templates/templates.service';
import { ActivityService } from '../activity/activity.service';
import { AutoReplyRepository } from './auto-reply.repository';

// TRẢ LỜI TỰ ĐỘNG: khách reply text / bấm Flow -> gửi ngay 1 template Meta đã duyệt
// (mẫu có cờ autoReply trong app), truyền biến customer_name = tên khách.
//
// Chống spam bằng COOLDOWN: mỗi số chỉ được trả lời 1 lần / AUTO_REPLY_COOLDOWN_MIN phút
// (mặc định 60) — khách nhắn dồn 10 tin vẫn chỉ nhận 1 tin trả lời.
// KHÔNG BAO GIỜ ném lỗi — chạy trong webhook, lỗi ở đây không được phá luồng nhận.

const COOLDOWN_MIN = () => Number(process.env.AUTO_REPLY_COOLDOWN_MIN || 60);
// Media id Meta sống ~30 ngày -> cache 25 ngày là an toàn, đỡ upload lại ảnh mỗi lần.
const MEDIA_TTL_MS = 25 * 24 * 60 * 60 * 1000;

// Template trả lời không gắn báo giá -> render biến với quotation rỗng
// (chỉ {khách hàng} có nghĩa; các biến khác ra chuỗi trống).
const EMPTY_QUOTATION = {
  code: '',
  title: null,
  totalAmount: 0,
  currency: '',
  market: null,
  issuedDate: null,
  validUntil: null,
};

type InboundLike = {
  id: bigint;
  fromPhone: string;
  fromName?: string | null;
  channel?: string;
  customerId?: bigint | null;
  customer?: { name: string } | null;
};

@Injectable()
export class AutoReplyService {
  constructor(
    private readonly repo: AutoReplyRepository,
    private readonly templatesService: TemplatesService,
    private readonly activityService: ActivityService,
  ) {}

  async maybeAutoReply(msg: InboundLike): Promise<void> {
    try {
      // Chỉ trả lời trên WhatsApp (Zalo chưa có OA gửi).
      if ((msg.channel || 'WHATSAPP').toUpperCase() !== 'WHATSAPP' || !msg.fromPhone) return;

      // 1) Tìm mẫu trả lời tự động đang bật.
      const tpl = await this.repo.findAutoReplyTemplate();
      if (!tpl) return; // chưa cấu hình -> im lặng

      // 1b) Khách đã phản hồi -> TỰ GẮN vào danh sách khách của mẫu reply (tích lũy
      // "tập khách đã phản hồi"; trùng thì bỏ qua). Chạy TRƯỚC cooldown để lần nào
      // reply cũng được gắn, kể cả khi không gửi tin trả lời.
      if (msg.customerId) {
        // lỗi gắn link không phá luồng trả lời
        await this.repo.linkCustomerToTemplate(tpl.id, msg.customerId).catch(() => {});
      }

      // 2) Cooldown: số này đã được trả lời trong X phút qua -> thôi.
      const since = new Date(Date.now() - COOLDOWN_MIN() * 60 * 1000);
      const recent = await this.repo.findRecentAutoReplied(msg.fromPhone, since, msg.id);
      if (recent) return;

      // 3) Biến customer_name: tên khách trong DB -> tên hiển thị WhatsApp -> fallback.
      const name = msg.customer?.name || msg.fromName || 'Quý khách';
      const bodyParams = renderBodyParams(tpl.waBodyParams, EMPTY_QUOTATION, { name }, []);

      // 4) Ảnh header (nếu mẫu có): dùng media id cache, hết hạn mới tải + upload lại.
      const token = process.env[tpl.channel?.apiKeyEnv || 'WHATSAPP_TOKEN_MAIN'];
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || tpl.channel?.accountId || '';
      const dryRun = isDryRun(); // dùng chung với lớp gửi tin
      let mediaId: string | undefined;
      const imgMeta = await this.repo.findImageMeta(tpl.id);
      if (imgMeta && token && phoneNumberId && !dryRun) {
        const fresh =
          imgMeta.waMediaId && imgMeta.waMediaAt && Date.now() - imgMeta.waMediaAt.getTime() < MEDIA_TTL_MS;
        if (fresh) {
          mediaId = imgMeta.waMediaId!;
        } else {
          const img = await this.templatesService.getTemplateImage(tpl.id);
          if (img) {
            mediaId = await uploadWhatsAppMedia({
              token,
              phoneNumberId,
              bytes: new Uint8Array(img.data).buffer,
              mime: img.mime,
              filename: `autoreply-${tpl.id}`,
            });
            await this.repo.saveMediaId(tpl.id, mediaId);
          }
        }
      }

      // 5) Gửi template trả lời.
      const r = await sendQuotationMessage({
        channelType: 'WHATSAPP',
        apiKeyEnv: tpl.channel?.apiKeyEnv,
        accountId: tpl.channel?.accountId,
        toPhone: msg.fromPhone,
        toName: name,
        text: '',
        wa: {
          templateName: tpl.waTemplateName!,
          language: tpl.waLanguage,
          mediaId,
          includeImage: !!mediaId,
          bodyParams,
          hasFlowButton: tpl.waFlow,
        },
      });

      // 6) Đánh dấu đã trả lời + ghi nhật ký.
      await this.repo.markAutoReplied(msg.id);
      await this.activityService.logActivity({
        action: 'TU_DONG_TRA_LOI',
        target: msg.fromPhone,
        result: 'SUCCESS',
        note: `mẫu "${tpl.name}" -> ${name} · ${r.messageId}`,
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.error('[autoReply] lỗi:', m);
      await this.activityService
        .logActivity({ action: 'TU_DONG_TRA_LOI', target: msg.fromPhone, result: 'FAILED', note: m })
        .catch(() => {});
    }
  }
}
