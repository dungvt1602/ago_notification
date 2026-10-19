import { Module } from '@nestjs/common';
import { ZaloController } from './zalo.controller';
import { ZaloService } from './zalo.service';
import { ZaloRepository } from './zalo.repository';
import { ZaloTokenService } from './zalo-token.service';
import { ZaloTokenRepository } from './zalo-token.repository';
import { ZaloLinkService } from './zalo-link.service';
import { ZaloLinkRepository } from './zalo-link.repository';
import { ZaloSenderService } from './zalo-sender.service';
import { ZaloSenderRepository } from './zalo-sender.repository';
import { ZaloClient } from './zalo.client';

@Module({
  controllers: [ZaloController],
  providers: [
    ZaloService,
    ZaloRepository,
    ZaloTokenService,
    ZaloTokenRepository,
    ZaloLinkService,
    ZaloLinkRepository,
    ZaloSenderService,
    ZaloSenderRepository,
    ZaloClient,
  ],
  exports: [ZaloTokenService, ZaloLinkService, ZaloSenderService, ZaloClient],
})
export class ZaloModule {}
