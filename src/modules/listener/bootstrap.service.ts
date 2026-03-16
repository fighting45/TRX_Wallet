import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ListenerService } from './listener.service';

/**
 * BootstrapService - Auto-starts TRON listener on application boot
 *
 * Features:
 * - Fetches all addresses from Laravel on startup
 * - Starts TRON listener automatically
 * - Allows registration of new addresses dynamically
 */
@Injectable()
export class BootstrapService implements OnModuleInit {
  private laravelUrl: string;
  private laravelApiSecret: string;
  private autoStart: boolean;

  constructor(
    private configService: ConfigService,
    private listenerService: ListenerService,
  ) {
    this.laravelUrl = this.configService.get('LARAVEL_URL');
    this.laravelApiSecret = this.configService.get('LARAVEL_API_SECRET');
    this.autoStart = this.configService.get('AUTO_START_LISTENERS', 'false') === 'true';
  }

  /**
   * Called automatically when NestJS module initializes
   */
  async onModuleInit() {
    if (!this.autoStart) {
      console.log('⏸️  Auto-start disabled. Set AUTO_START_LISTENERS=true to enable.');
      return;
    }

    console.log('🚀 Bootstrap: Auto-starting TRON listener...');

    try {
      // Fetch all addresses from Laravel
      const addresses = await this.fetchAddressesFromLaravel();

      if (addresses.length === 0) {
        console.log('⚠️  No addresses found in Laravel. Listener will start when addresses are registered.');
        return;
      }

      // Start listener in background (don't await - it runs indefinitely)
      this.listenerService.startListener(addresses).catch((error) => {
        console.error('❌ Listener crashed:', error.message);
      });

      console.log(`✅ Bootstrap complete: Monitoring ${addresses.length} addresses`);
    } catch (error) {
      console.error('❌ Bootstrap failed:', error.message);
      console.log('💡 Make sure Laravel is running and LARAVEL_URL is correct');
      console.log('🔄 Will retry when addresses are registered via API');
    }
  }

  /**
   * Fetch all TRON addresses from Laravel
   */
  private async fetchAddressesFromLaravel(): Promise<Array<{ user_id: number; address: string }>> {
    try {
      const response = await axios.get(`${this.laravelUrl}/api/wallet-service/addresses`, {
        headers: {
          'X-API-Secret': this.laravelApiSecret,
        },
        params: {
          network: 'tron',
        },
        timeout: 10000,
      });

      const addresses = response.data.addresses || [];
      console.log(`📥 Fetched ${addresses.length} addresses from Laravel`);

      // Filter only TRON addresses
      const tronAddresses = addresses.filter((addr: any) => addr.network === 'tron');

      return tronAddresses.map((addr: any) => ({
        user_id: addr.user_id,
        address: addr.address,
      }));
    } catch (error) {
      console.error('Error fetching addresses from Laravel:', error.message);
      return [];
    }
  }

  /**
   * Register a new address for monitoring
   * Called when Laravel generates a new address
   */
  async registerNewAddress(userId: number, address: string): Promise<void> {
    console.log(`➕ Registering new address: ${address} for user ${userId}`);
    await this.listenerService.registerAddress(userId, address);
  }
}
