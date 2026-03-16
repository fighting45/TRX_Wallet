import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Get config service
  const configService = app.get(ConfigService);
  const port = configService.get('PORT', 3001);

  // Enable CORS (for Laravel integration)
  app.enableCors({
    origin: configService.get('LARAVEL_URL'),
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix('api');

  await app.listen(port);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║                                                      ║');
  console.log('║         🚀 TRX Wallet Service Started 🚀            ║');
  console.log('║                                                      ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Port:         ${port.toString().padEnd(38)} ║`);
  console.log(`║  Network:      TRON/TRC20                            ║`);
  console.log(`║  Environment:  ${configService.get('NODE_ENV', 'development').padEnd(38)} ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  API Docs:     http://localhost:${port}/api          ║`);
  console.log(`║  Health:       http://localhost:${port}/api/wallet/health  ║`);
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
}

bootstrap();
