import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { webReq } from '@common/http/web-request';
import { parseId } from '@common/http/parse-id';
import { AuditService } from '@common/audit/audit.service';
import { dryRunMessageId, isDryRun } from '@core/lib/sendMode';
import { sendRfqSchema, testSendSchema } from '@core/validation/supplierRfq.schema';
import { ZaloClient } from '../zalo/zalo.client';
import { httpError, MSG, rfqBaseUrl } from './rfq-errors';
import { generateToken, hashToken, invitationExpiry } from './rfq-token';
import { SupplierRfqRepository } from './supplier-rfq.repository';
import {
  buildRfqImageMessage,
  buildRfqMessage,
  shouldFallbackToText,
  type RfqMessageInput,
  type RfqMessageMode,
} from './zalo-rfq-message';

type Rfq = NonNullable<Awaited<ReturnType<SupplierRfqRepository['findWithItems']>>>;
type Supplier = Awaited<ReturnType<SupplierRfqRepository['findSuppliersByIds']>>[number];

export type DeliverResult = {
  ok: boolean;
  mode: RfqMessageMode;
  error?: string;
  zalo?: unknown;
  messageId?: string;
  buttonError?: string; // lỗi của tin có nút (khi đã rơi về chữ hoặc cả hai đều hỏng)
  imageSent: boolean;
  imageError?: string;
};

export type SendResult = {
  supplierId: string;
  supplierName: string;
  ok: boolean;
  status: string;
  error?: string;
  invitationId?: string;
};

// Lời mời đã tới tay NCC (hoặc NCC đã xem/nộp) — gửi lại cần cờ resend.
const DELIVERED = new Set(['SENT', 'VIEWED', 'SUBMITTED']);

// Nhắn thử: tối đa 20 lượt / giờ / RFQ để API không bị dùng làm máy phát tin Zalo.
const TEST_MAX_PER_HOUR = 20;

// Không bao giờ trả thông điệp Prisma thô (lộ tên bảng/cột/câu truy vấn) ra kết quả gửi.
// SĐT hay nhập có khoảng trắng / chấm / gạch ngang -> bỏ đi cho resolveZaloUserId nhận ra là số điện thoại.
const cleanTarget = (v: string) => v.replace(/[\s.-]/g, '');

function friendlyError(err: unknown): string {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientValidationError ||
    err instanceof Prisma.PrismaClientUnknownRequestError ||
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  ) {
    return MSG.internal;
  }
  const m = err instanceof Error ? err.message : String(err);
  return /prisma|invocation/i.test(m) ? MSG.internal : m;
}

@Injectable()
export class SupplierRfqSendService {
  // Chặn bấm đúp: mỗi (rfq, NCC) chỉ một lượt gửi chạy cùng lúc -> không sinh hai token / hai tin.
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly repo: SupplierRfqRepository,
    private readonly zalo: ZaloClient,
    private readonly audit: AuditService,
  ) {}

  // Giãn nhịp gọi Zalo trong một lượt gửi: tối thiểu paceMs giữa hai lần gọi (OA gói thường ~100 request/phút).
  paceMs = 700;
  private lastZaloAt = 0;
  private async gap(): Promise<void> {
    const wait = this.lastZaloAt + this.paceMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastZaloAt = Date.now();
  }

  /*
   * Gửi RFQ tới 1 user_id: (1) tin ảnh riêng nếu có — lỗi chỉ ghi imageError, KHÔNG chặn; (2) tin có nút "Nhập giá";
   * Zalo từ chối bằng lỗi nghiệp vụ (không thuộc nhóm người nhận/hạn mức/token) thì thử lại ĐÚNG MỘT lần dạng chữ.
   * Không bao giờ ném lỗi. pace=true (gửi hàng loạt) thì giãn nhịp giữa các cuộc gọi; nhắn thử không chờ.
   */
  async deliver(zaloUserId: string, input: RfqMessageInput, pace = false): Promise<DeliverResult> {
    const call = async (msg: Record<string, unknown>) => {
      if (pace) await this.gap();
      return this.zalo.sendRfqMessage(zaloUserId, msg);
    };
    let imageSent = false;
    let imageError: string | undefined;
    if (input.imageUrl) {
      const img = await call(buildRfqImageMessage(input.imageUrl));
      imageSent = img.ok;
      if (!img.ok) imageError = img.error ?? 'Gửi ảnh lỗi';
    }
    const img = { imageSent, ...(imageError ? { imageError } : {}) };
    const btn = await call(buildRfqMessage('buttons', input));
    if (btn.ok) return { ok: true, mode: 'buttons', zalo: btn.resp, messageId: btn.messageId, ...img };
    const buttonError = btn.error ?? 'lỗi';
    if (!shouldFallbackToText(btn.code)) {
      return { ok: false, mode: 'buttons', zalo: btn.resp, error: buttonError, buttonError, ...img };
    }
    const text = await call(buildRfqMessage('text', input));
    if (text.ok) {
      return { ok: true, mode: 'text', zalo: text.resp, messageId: text.messageId, buttonError, ...img };
    }
    return {
      ok: false,
      mode: 'text',
      zalo: text.resp ?? btn.resp,
      error: text.error ?? 'lỗi',
      buttonError,
      ...img,
    };
  }

  private messageInput(rfq: Rfq, link: string, baseUrl: string): RfqMessageInput {
    return {
      code: rfq.code,
      title: rfq.title,
      deadline: rfq.deadline,
      note: rfq.note,
      itemCount: rfq.items.length,
      link,
      imageUrl: rfq.image ? `${baseUrl}/api/supplier-rfqs/${rfq.id}/zalo-image` : null,
    };
  }

  async send(req: Request, idRaw: string, body: unknown) {
    const id = parseId(idRaw, 'Id yêu cầu báo giá');
    const input = sendRfqSchema.parse(body);
    const rfq = await this.repo.findWithItems(id);
    if (!rfq) throw httpError(404, MSG.rfqNotFound);
    if (rfq.status === 'CLOSED') throw new Error(MSG.rfqClosed);
    if (rfq.items.length === 0) throw new Error('Yêu cầu báo giá chưa có mặt hàng nào.');
    if (rfq.deadline && rfq.deadline.getTime() < Date.now()) throw new Error(MSG.pastDeadline);

    const baseUrl = rfqBaseUrl();
    const ids = [...new Set(input.supplierIds)];
    const suppliers = new Map(
      (await this.repo.findSuppliersByIds(ids.map((s) => BigInt(s)))).map((s) => [s.id.toString(), s]),
    );
    const results: SendResult[] = [];
    // Tuần tự: Zalo giới hạn tần suất và mỗi NCC cần ghi trạng thái riêng, lỗi một NCC không dừng cả lượt.
    for (const sid of ids) {
      const supplier = suppliers.get(sid);
      if (!supplier) {
        results.push({
          supplierId: sid,
          supplierName: '',
          ok: false,
          status: 'FAILED',
          error: 'Không tìm thấy nhà cung cấp.',
        });
        continue;
      }
      const key = `${rfq.id}:${supplier.id}`;
      if (this.inFlight.has(key)) {
        results.push({
          ...{ supplierId: sid, supplierName: supplier.name },
          ok: false,
          status: 'PENDING',
          error: MSG.inFlight,
        });
        continue;
      }
      this.inFlight.add(key);
      try {
        results.push(await this.sendOne(rfq, supplier, baseUrl, !!input.resend));
      } catch (err) {
        results.push({
          supplierId: sid,
          supplierName: supplier.name,
          ok: false,
          status: 'FAILED',
          error: friendlyError(err),
        });
      } finally {
        this.inFlight.delete(key);
      }
    }

    // Skip "đã gửi trước đó" không phải lần gửi mới; chỉ lần gửi thành công thật mới đẩy DRAFT -> SENT.
    if (results.some((r) => r.ok && r.error !== MSG.alreadySent)) await this.repo.markSentIfDraft(id);
    const okCount = results.filter((r) => r.ok && r.error !== MSG.alreadySent).length;
    await this.audit.audit(webReq(req), {
      action: 'RFQ_GUI',
      target: `${rfq.code} · ${rfq.title}`,
      note: `${okCount}/${results.length} NCC${isDryRun() ? ' (gửi giả)' : ''}`,
      result: okCount === 0 && results.length > 0 && results.every((r) => !r.ok) ? 'FAILED' : 'SUCCESS',
    });
    return { results };
  }

  private async sendOne(rfq: Rfq, supplier: Supplier, baseUrl: string, resend: boolean): Promise<SendResult> {
    const base = { supplierId: supplier.id.toString(), supplierName: supplier.name };
    const existing = await this.repo.findInvitation(rfq.id, supplier.id);

    if (existing && DELIVERED.has(existing.status) && !resend) {
      return {
        ...base,
        ok: true,
        status: existing.status,
        error: MSG.alreadySent,
        invitationId: existing.id.toString(),
      };
    }
    if (supplier.status !== 'ACTIVE') {
      return {
        ...base,
        ok: false,
        status: existing?.status ?? 'FAILED',
        error: MSG.inactive,
        invitationId: existing?.id.toString(),
      };
    }
    // Người nhận = Zalo user_id nếu có, không thì SĐT (Zalo tự yêu cầu họ đã Quan tâm OA).
    const target = cleanTarget(supplier.zaloUserId || supplier.phone || '');
    if (!target) {
      return {
        ...base,
        ok: false,
        status: existing?.status ?? 'FAILED',
        error: MSG.noZaloUserId,
        invitationId: existing?.id.toString(),
      };
    }

    // Đổi SĐT -> user_id TRƯỚC khi đụng lời mời/token: tra lỗi thì trạng thái không bị thay đổi gì. Gửi giả (dry-run)
    // không gọi mạng nên không tra.
    let zaloId = target;
    if (!isDryRun()) {
      try {
        await this.gap();
        zaloId = await this.zalo.resolveZaloUserId(target);
      } catch (err) {
        return {
          ...base,
          ok: false,
          status: existing?.status ?? 'FAILED',
          error: friendlyError(err),
          invitationId: existing?.id.toString(),
        };
      }
      if (!supplier.zaloUserId && zaloId !== target) {
        // Lưu để lần sau khỏi tra lại; hỏng cũng không làm hỏng lượt gửi.
        await this.repo.setSupplierZaloUserId(supplier.id, zaloId).catch(() => undefined);
      }
    }

    const now = new Date();
    // Token lưu chỉ dạng băm nên không dựng lại được link cũ: mỗi lần gửi sinh token MỚI.
    const token = generateToken();
    const newHash = hashToken(token);
    const link = `${baseUrl}/ncc/${token}`;
    const expiresAt = invitationExpiry(rfq.deadline, now);
    let inv = existing;
    if (!inv) {
      try {
        inv = await this.repo.createInvitation({
          rfqId: rfq.id,
          supplierId: supplier.id,
          tokenHash: newHash,
          isTest: false,
          status: 'PENDING',
          expiresAt,
          channel: 'ZALO',
        });
      } catch (err) {
        // Ai đó vừa tạo lời mời (instance khác / đua) -> đọc lại thay vì báo lỗi unique.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
        inv = await this.repo.findInvitation(rfq.id, supplier.id);
        if (!inv) throw err;
        return {
          ...base,
          ok: true,
          status: inv.status,
          error: MSG.alreadySent,
          invitationId: inv.id.toString(),
        };
      }
    } else {
      // Lưu hash MỚI trước khi gọi Zalo: tin đã tới tay NCC thì link trong tin chắc chắn dùng được
      // (không có khoảng "đã gửi nhưng DB còn hash cũ"). Gửi lỗi thì trả hash/hạn cũ để link cũ vẫn sống.
      await this.repo.updateInvitation(inv.id, { tokenHash: newHash, expiresAt });
    }

    let res: { ok: boolean; messageId?: string; error?: string };
    try {
      if (isDryRun()) {
        // Gửi giả: không gọi mạng, chỉ đánh dấu DRYRUN- để tra log biết tin không có thật.
        res = { ok: true, messageId: dryRunMessageId() };
      } else {
        res = await this.deliver(zaloId, this.messageInput(rfq, link, baseUrl), true);
      }
    } catch (err) {
      res = { ok: false, error: friendlyError(err) };
    }

    if (res.ok) {
      const keep = existing && (existing.status === 'VIEWED' || existing.status === 'SUBMITTED');
      const status = keep ? existing.status : 'SENT';
      await this.repo.updateInvitation(inv.id, {
        status,
        sentAt: now,
        messageId: res.messageId ?? null,
        error: null,
      });
      return { ...base, ok: true, status, invitationId: inv.id.toString() };
    }
    // Gửi lại bị lỗi: khôi phục hash/hạn cũ và giữ trạng thái "đã nhận/đã nộp" của lần trước.
    const status = existing && DELIVERED.has(existing.status) ? existing.status : 'FAILED';
    await this.repo.updateInvitation(inv.id, {
      status,
      error: res.error ?? 'Gửi lỗi',
      ...(existing ? { tokenHash: existing.tokenHash, expiresAt: existing.expiresAt } : {}),
    });
    return { ...base, ok: false, status, error: res.error ?? 'Gửi lỗi', invitationId: inv.id.toString() };
  }

  /*
   * "Nhắn thử": gửi ĐÚNG tin đó tới 1 user_id nội bộ, luôn gọi Zalo thật (kể cả khi SEND_DRY_RUN) vì là thao tác
   * chủ động và chỉ tới người được chỉ định. Tạo lời mời is_test (không NCC, không vào so sánh) để link thử mở được.
   */
  async testSend(req: Request, idRaw: string, body: unknown) {
    const id = parseId(idRaw, 'Id yêu cầu báo giá');
    const input = testSendSchema.parse(body);
    const rfq = await this.repo.findWithItems(id);
    if (!rfq) throw httpError(404, MSG.rfqNotFound);

    const baseUrl = rfqBaseUrl();
    if (
      (await this.repo.countTestInvitationsSince(rfq.id, new Date(Date.now() - 3600_000))) >=
      TEST_MAX_PER_HOUR
    ) {
      throw httpError(429, MSG.tooManyTests);
    }
    // Nhận user_id HOẶC SĐT: tra trước, lỗi (chưa Quan tâm OA...) trả ok:false (HTTP 200), chưa tạo lời mời nào.
    let zaloId = input.zaloUserId;
    try {
      zaloId = await this.zalo.resolveZaloUserId(input.zaloUserId);
    } catch (err) {
      return {
        ok: false,
        mode: 'buttons' as RfqMessageMode,
        link: '',
        imageSent: false,
        error: friendlyError(err),
      };
    }
    const now = new Date();
    const token = generateToken();
    const link = `${baseUrl}/ncc/${token}`;
    const inv = await this.repo.createInvitation({
      rfqId: rfq.id,
      supplierId: null,
      tokenHash: hashToken(token),
      isTest: true,
      status: 'PENDING',
      expiresAt: invitationExpiry(rfq.deadline, now),
      channel: 'ZALO',
    });
    const res = await this.deliver(zaloId, this.messageInput(rfq, link, baseUrl));
    await this.repo.updateInvitation(
      inv.id,
      res.ok
        ? { status: 'SENT', sentAt: now, messageId: res.messageId ?? null }
        : { status: 'FAILED', error: res.error ?? 'Gửi lỗi' },
    );
    await this.audit.audit(webReq(req), {
      action: 'RFQ_NHAN_THU',
      target: `${rfq.code} · ${rfq.title}`,
      note: res.ok ? `dạng ${res.mode}` : (res.error ?? 'lỗi'),
      result: res.ok ? 'SUCCESS' : 'FAILED',
    });
    return {
      ok: res.ok,
      mode: res.mode,
      link,
      ...(zaloId !== input.zaloUserId ? { resolvedUserId: zaloId } : {}),
      ...(res.error ? { error: res.error } : {}),
      ...(res.zalo !== undefined ? { zalo: res.zalo } : {}),
      ...(res.buttonError ? { buttonError: res.buttonError } : {}),
      imageSent: res.imageSent,
      ...(res.imageError ? { imageError: res.imageError } : {}),
    };
  }
}
