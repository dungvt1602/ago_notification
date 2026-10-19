import { Controller, Get } from '@nestjs/common';
import { handle } from '@common/http/handle';
import { listActivity } from '@core/services/activityService';

/* Cổng từ Next: GET /api/activity. */
@Controller('activity')
export class ActivityController {
  @Get()
  get() {
    return handle(() => listActivity(), 500);
  }
}
