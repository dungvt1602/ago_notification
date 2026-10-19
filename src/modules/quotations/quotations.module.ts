import { Module } from '@nestjs/common';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';

@Module({ providers: [QuotationsService], controllers: [QuotationsController], exports: [QuotationsService] })
export class QuotationsModule {}
