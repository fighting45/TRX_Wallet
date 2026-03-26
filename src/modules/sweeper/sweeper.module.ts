import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SweeperController } from './sweeper.controller';
import { SweeperService } from './sweeper.service';
import { SweepTransaction } from '../../entities/sweep-transaction.entity';
import { WalletModule } from '../wallet/wallet.module';
import { EncryptionModule } from '../encryption/encryption.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SweepTransaction]),
    WalletModule,
    EncryptionModule,
  ],
  controllers: [SweeperController],
  providers: [SweeperService],
  exports: [SweeperService],
})
export class SweeperModule {}
