import { Controller, Get } from '@nestjs/common';
import { handle } from '@common/http/handle';
import { ActivityService } from './activity.service';

/* Cổng từ Next: GET /api/activity. */
@Controller('activity')
export class ActivityController {
  constructor(private readonly service: ActivityService) {}

  @Get()
  get() {
    return handle(() => this.service.list(), 500);
  }
}
