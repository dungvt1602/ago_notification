import { Injectable } from '@nestjs/common';
import {
  previewSend,
  confirmSend,
  cancelSend,
  processNextBatch,
  listBatches,
  getBatch,
} from '@core/services/sendService';
import { listSendJobs } from '@core/services/sendJobService';
import { previewSchema, confirmSchema, cancelSchema } from '@core/validation/send.schema';
import { actorFromRequest } from '@core/services/auditService';
import type { ReqLike } from '@core/http/reqLike';

@Injectable()
export class SendService {
  async preview(req: ReqLike, body: unknown) {
    const input = previewSchema.parse(body);
    const a = actorFromRequest(req);
    return previewSend({
      ...input,
      actor: { id: input.actor?.id ?? a.id, name: input.actor?.name ?? a.name },
    });
  }

  async confirm(req: ReqLike, body: unknown) {
    const input = confirmSchema.parse(body);
    const a = actorFromRequest(req);
    return confirmSend({
      ...input,
      actor: { id: input.actor?.id ?? a.id, name: input.actor?.name ?? a.name },
    });
  }

  async cancel(req: ReqLike, body: unknown) {
    return cancelSend({ ...cancelSchema.parse(body), actor: actorFromRequest(req) });
  }

  process() {
    return processNextBatch();
  }

  listBatches() {
    return listBatches();
  }

  getBatch(id: string) {
    return getBatch(id);
  }

  listJobs() {
    return listSendJobs();
  }
}
