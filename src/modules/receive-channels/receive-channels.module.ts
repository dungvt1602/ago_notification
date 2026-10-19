import { Module } from '@nestjs/common';
import { ReceiveChannelsController } from './receive-channels.controller';
import { ReceiveChannelsService } from './receive-channels.service';
import { ReceiveChannelsRepository } from './receive-channels.repository';

@Module({
  controllers: [ReceiveChannelsController],
  providers: [ReceiveChannelsService, ReceiveChannelsRepository],
  exports: [ReceiveChannelsService],
})
export class ReceiveChannelsModule {}
