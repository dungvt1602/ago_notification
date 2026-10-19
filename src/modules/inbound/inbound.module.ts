import { Module } from '@nestjs/common';
import { InboundController } from './inbound.controller';

@Module({ controllers: [InboundController] })
export class InboundModule {}
