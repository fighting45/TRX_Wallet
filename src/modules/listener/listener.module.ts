import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ListenerService } from './listener.service';
import { BootstrapService } from './bootstrap.service';
import { ProcessedDeposit, NetworkSyncState, WebhookQueue } from '../../entities';

@Module({
  imports: [TypeOrmModule.forFeature([ProcessedDeposit, NetworkSyncState, WebhookQueue])],
  providers: [ListenerService, BootstrapService],
  exports: [ListenerService, BootstrapService],
})
export class ListenerModule {}
