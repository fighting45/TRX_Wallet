import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletModule } from './modules/wallet/wallet.module';
import { ListenerModule } from './modules/listener/listener.module';
import { EncryptionModule } from './modules/encryption/encryption.module';
import { ProcessedDeposit, NetworkSyncState, WebhookQueue } from './entities';

@Module({
  imports: [
    // Load environment variables
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Database connection
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST', 'localhost'),
        port: configService.get('DB_PORT', 5432),
        username: configService.get('DB_USERNAME', 'postgres'),
        password: configService.get('DB_PASSWORD', 'password'),
        database: configService.get('DB_DATABASE', 'tron_wallet'),
        entities: [ProcessedDeposit, NetworkSyncState, WebhookQueue],
        synchronize: configService.get('NODE_ENV') === 'development', // Auto-create tables in dev
        logging: configService.get('DB_LOGGING', 'false') === 'true',
      }),
    }),

    // Application modules
    WalletModule,
    ListenerModule,
    EncryptionModule,
  ],
})
export class AppModule {}
