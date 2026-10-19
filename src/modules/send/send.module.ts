import { Module } from '@nestjs/common';
import { SendController } from './send.controller';
import { SendService } from './send.service';

@Module({ providers: [SendService], controllers: [SendController], exports: [SendService] })
export class SendModule {}
