import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { EncryptionModule } from '../encryption/encryption.module';
import { ListenerModule } from '../listener/listener.module';

@Module({
  imports: [EncryptionModule, ListenerModule],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
