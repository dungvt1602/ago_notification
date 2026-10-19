import { Module } from '@nestjs/common';
import { SendModule } from '../send/send.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardRepository } from './dashboard.repository';

@Module({
  imports: [SendModule],
  providers: [DashboardService, DashboardRepository],
  controllers: [DashboardController],
  exports: [DashboardService],
})
export class DashboardModule {}
