import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({ providers: [DashboardService], controllers: [DashboardController], exports: [DashboardService] })
export class DashboardModule {}
