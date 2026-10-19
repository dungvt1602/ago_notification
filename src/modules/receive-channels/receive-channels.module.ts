import { Module } from '@nestjs/common';
import { ReceiveChannelsController } from './receive-channels.controller';

@Module({ controllers: [ReceiveChannelsController] })
export class ReceiveChannelsModule {}
