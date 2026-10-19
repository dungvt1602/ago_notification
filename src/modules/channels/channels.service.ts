import { Injectable } from '@nestjs/common';
import type { Channel } from '@prisma/client';
import type { ReqLike } from '@core/http/reqLike';
import {
  createChannelSchema,
  updateChannelSchema,
  type CreateChannelInput,
  type UpdateChannelInput,
} from '@core/validation/channel.schema';
import { AuditService } from '@common/audit/audit.service';
import { labelOf, diffSummary } from '@common/audit/audit.helpers';
import { ChannelsRepository } from './channels.repository';

@Injectable()
export class ChannelsService {
  constructor(
    private readonly repo: ChannelsRepository,
    private readonly auditService: AuditService,
  ) {}

  listChannels() {
    return this.repo.findAll();
  }

  createChannel(input: CreateChannelInput) {
    return this.repo.create(input);
  }

  updateChannel(id: string, input: UpdateChannelInput) {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.type !== undefined) data.type = input.type;
    if (input.accountId !== undefined) data.accountId = input.accountId;
    if (input.apiKeyEnv !== undefined) data.apiKeyEnv = input.apiKeyEnv;
    if (input.note !== undefined) data.note = input.note;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    return this.repo.update(BigInt(id), data);
  }

  async deleteChannel(id: string) {
    await this.repo.deleteWithRelations(BigInt(id));
    return { ok: true };
  }

  // Lấy API key THẬT của một kênh từ biến môi trường.
  // DB chỉ lưu channel.apiKeyEnv (tên biến), key thật đọc từ process.env ở đây.
  getChannelApiKey(channel: Pick<Channel, 'apiKeyEnv' | 'name'>): string {
    const key = process.env[channel.apiKeyEnv];
    if (!key) {
      throw new Error(
        `Thiếu API key cho kênh "${channel.name}": chưa đặt biến môi trường ${channel.apiKeyEnv} trong .env`,
      );
    }
    return key;
  }

  async create(body: unknown, req: ReqLike) {
    const input = createChannelSchema.parse(body);
    const c = await this.createChannel(input);
    await this.auditService.audit(req, {
      action: 'KENH_GUI_TAO',
      target: labelOf('channel', c as unknown as Record<string, unknown>),
      note: diffSummary(null, input as Record<string, unknown>),
    });
    return c;
  }

  async update(id: string, body: unknown, req: ReqLike) {
    const input = updateChannelSchema.parse(body);
    const before = await this.auditService.snapshot('channel', id);
    const r = await this.updateChannel(id, input);
    await this.auditService.audit(req, {
      action: 'KENH_GUI_SUA',
      target: labelOf('channel', before, id),
      note: diffSummary(before, input as Record<string, unknown>) || 'không đổi gì',
    });
    return r;
  }

  async remove(id: string, req: ReqLike) {
    const before = await this.auditService.snapshot('channel', id);
    const r = await this.deleteChannel(id);
    await this.auditService.audit(req, { action: 'KENH_GUI_XOA', target: labelOf('channel', before, id) });
    return r;
  }
}
