import { Module } from '@nestjs/common';
import { InboundController } from './inbound.controller';
import { InboundService } from './inbound.service';

@Module({ providers: [InboundService], controllers: [InboundController], exports: [InboundService] })
export class InboundModule {}
