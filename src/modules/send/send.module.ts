import { Module } from '@nestjs/common';
import { SendController } from './send.controller';

@Module({ controllers: [SendController] })
export class SendModule {}
