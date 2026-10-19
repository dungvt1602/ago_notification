import { Injectable } from '@nestjs/common';
import { listActivity } from '@core/services/activityService';

@Injectable()
export class ActivityService {
  list() {
    return listActivity();
  }
}
