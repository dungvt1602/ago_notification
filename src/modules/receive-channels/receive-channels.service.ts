import { Injectable } from '@nestjs/common';
import type { ReqLike } from '@core/http/reqLike';
import {
  createReceiveChannelSchema,
  updateReceiveChannelSchema,
  type CreateReceiveChannelInput,
  type UpdateReceiveChannelInput,
} from '@core/validation/receiveChannel.schema';
import { AuditService } from '@common/audit/audit.service';
import { labelOf, diffSummary } from '@common/audit/audit.helpers';
import { ReceiveChannelsRepository } from './receive-channels.repository';

@Injectable()
export class ReceiveChannelsService {
  constructor(
    private readonly repo: ReceiveChannelsRepository,
    private readonly auditService: AuditService,
  ) {}

  listReceiveChannels() {
    return this.repo.findAll();
  }

  createReceiveChannel(input: CreateReceiveChannelInput) {
    return this.repo.create(input);
  }

  updateReceiveChannel(id: string, input: UpdateReceiveChannelInput) {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.type !== undefined) data.type = input.type;
    if (input.accountId !== undefined) data.accountId = input.accountId;
    if (input.apiKeyEnv !== undefined) data.apiKeyEnv = input.apiKeyEnv;
    if (input.note !== undefined) data.note = input.note;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    return this.repo.update(BigInt(id), data);
  }

  async deleteReceiveChannel(id: string) {
    await this.repo.deleteWithRelations(BigInt(id));
    return { ok: true };
  }

  // Tra kênh nhận theo (type, accountId) — webhook dùng để gắn tin về đúng kênh.
  // Chỉ khớp kênh đang bật. Không thấy -> null (tin vẫn lưu, chỉ không gắn kênh).
  async findReceiveChannelId(type: string, accountId: string): Promise<bigint | null> {
    if (!accountId) return null;
    const ch = await this.repo.findActiveIdByTypeAccount(type.toUpperCase(), accountId);
    return ch?.id ?? null;
  }

  async create(body: unknown, req: ReqLike) {
    const input = createReceiveChannelSchema.parse(body);
    const c = await this.createReceiveChannel(input);
    await this.auditService.audit(req, {
      action: 'KENH_NHAN_TAO',
      target: labelOf('receiveChannel', c as unknown as Record<string, unknown>),
      note: `nhận: ${input.accountId}${input.note ? ' — ' + input.note : ''}`,
    });
    return c;
  }

  async update(id: string, body: unknown, req: ReqLike) {
    const input = updateReceiveChannelSchema.parse(body);
    const before = await this.auditService.snapshot('receiveChannel', id);
    const r = await this.updateReceiveChannel(id, input);
    await this.auditService.audit(req, {
      action: 'KENH_NHAN_SUA',
      target: labelOf('receiveChannel', before, id),
      note: diffSummary(before, input as Record<string, unknown>) || 'không đổi gì',
    });
    return r;
  }

  async remove(id: string, req: ReqLike) {
    const before = await this.auditService.snapshot('receiveChannel', id);
    const r = await this.deleteReceiveChannel(id);
    await this.auditService.audit(req, {
      action: 'KENH_NHAN_XOA',
      target: labelOf('receiveChannel', before, id),
      note: before ? `nhận: ${before.accountId}` : null,
    });
    return r;
  }
}
