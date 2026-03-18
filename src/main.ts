import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ConfigService } from "@nestjs/config";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Get config service
  const configService = app.get(ConfigService);
  const port = configService.get("PORT", 3001);

  // Enable CORS (for Laravel integration)
  app.enableCors({
    origin: configService.get("LARAVEL_URL"),
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix("api");

  // Swagger API Documentation (for Laravel Integration)
  const config = new DocumentBuilder()
    .setTitle("TRX Wallet Service - Laravel Integration API")
    .setDescription(
      "🔗 **Laravel Integration Guide**\n\n" +
      "This API provides TRON (TRX/TRC20 USDT) wallet functionality for your Laravel application.\n\n" +
      "**Quick Start:**\n" +
      "1. Call `/wallet/generate-mnemonic` **ONCE** during setup → Store encrypted mnemonic in Laravel DB\n" +
      "2. Call `/wallet/get-address` with user_id whenever user needs deposit address\n" +
      "3. Implement webhook endpoint `POST /api/deposits/webhook` in Laravel to receive deposits\n\n" +
      "**Deposit Detection:**\n" +
      "- Automatic monitoring every 5 minutes\n" +
      "- Webhooks sent to Laravel with HMAC signature\n" +
      "- Duplicate prevention with database tracking\n\n" +
      "**Security:**\n" +
      "- Mnemonic encrypted with AES-256-GCM\n" +
      "- Webhooks signed with HMAC-SHA256\n" +
      "- Never exposes private keys via API"
    )
    .setVersion("1.0")
    .addServer("https://trx-wallet.exbotixgenie.com", "Production Server")
    .addServer("http://localhost:3002", "Local Development")
    .addTag("Laravel Integration", "Endpoints for Laravel wallet integration")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document, {
    customSiteTitle: "TRX Wallet API - Laravel Integration",
    customCss: ".swagger-ui .topbar { display: none }",
  });

  await app.listen(port);

  console.log("");
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║                                                            ║");
  console.log("║         🚀 TRX Wallet Service Started 🚀                  ║");
  console.log("║                                                            ║");
  console.log("╠════════════════════════════════════════════════════════════╣");
  console.log(`║  Port:         ${port.toString().padEnd(46)} ║`);
  console.log(`║  Network:      TRON/TRC20                                  ║`);
  console.log(
    `║  Environment:  ${configService.get("NODE_ENV", "development").padEnd(46)} ║`,
  );
  console.log("╠════════════════════════════════════════════════════════════╣");
  console.log(`║  📚 Swagger Docs: http://localhost:${port}/api/docs           ║`);
  console.log(`║  🏥 Health:       http://localhost:${port}/api/wallet/health  ║`);
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("");
}

bootstrap();
