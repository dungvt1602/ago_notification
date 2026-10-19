import { Injectable } from '@nestjs/common';
import type { ReqLike } from '@core/http/reqLike';
import { ActivityService } from '../../modules/activity/activity.service';
import { AuditRepository } from './audit.repository';
import { actorFromRequest, type Actor, type Model } from './audit.helpers';

/*
 * NHẬT KÝ THAO TÁC: mọi route thêm/sửa/xoá gọi audit(req, {...}) sau khi làm xong.
 * Người thực hiện lấy từ header x-actor-id / x-actor-name do client tự gắn.
 * Không bao giờ ném lỗi — ghi nhật ký hỏng không được làm hỏng thao tác chính.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly activity: ActivityService,
    private readonly repo: AuditRepository,
  ) {}

  async audit(
    req: ReqLike | null | undefined,
    input: {
      action: string;
      target?: string | null;
      note?: string | null;
      result?: 'SUCCESS' | 'FAILED';
      actor?: Actor;
    },
  ): Promise<void> {
    const actor = input.actor ?? actorFromRequest(req);
    await this.activity.logActivity({
      userId: actor.id,
      actorName: actor.name,
      action: input.action,
      target: input.target ?? null,
      result: input.result ?? 'SUCCESS',
      note: input.note ?? null,
    });
  }

  // Lấy bản ghi TRƯỚC khi sửa/xoá để ghi diff + tên đối tượng (không có -> null, không lỗi).
  async snapshot(model: Model, id: string): Promise<Record<string, unknown> | null> {
    try {
      // Không await: lỗi DB bất đồng bộ phải lan ra như bản gốc, chỉ lỗi đồng bộ (BigInt(id) sai) mới bị nuốt.
      return this.repo.findBefore(model, id) as Promise<Record<string, unknown> | null>;
    } catch {
      return null;
    }
  }
}
