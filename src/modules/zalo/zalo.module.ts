import { Module } from '@nestjs/common';
import { ZaloController } from './zalo.controller';
import { ZaloService } from './zalo.service';

@Module({ controllers: [ZaloController], providers: [ZaloService] })
export class ZaloModule {}
