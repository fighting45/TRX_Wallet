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
  private retryInterval: NodeJS.Timeout | null = null;
  private isListenerStarted: boolean = false;

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

    // Start retry loop
    await this.tryFetchAndStartListener();
  }

  /**
   * Attempts to fetch addresses and start listener with retry mechanism
   */
  private async tryFetchAndStartListener() {
    if (this.isListenerStarted) {
      console.log('✅ Listener already started, skipping fetch');
      return;
    }

    try {
      // Fetch all addresses from Laravel
      const addresses = await this.fetchAddressesFromLaravel();

      if (addresses.length === 0) {
        console.log('⚠️  No addresses found in Laravel.');
        console.log('🔄 Will retry in 5 minutes...');
        this.scheduleRetry();
        return;
      }

      // Start listener in background (don't await - it runs indefinitely)
      this.listenerService.startListener(addresses).catch((error) => {
        console.error('❌ Listener crashed:', error.message);
        this.isListenerStarted = false;
        // Schedule retry if listener crashes
        this.scheduleRetry();
      });

      console.log(`✅ Bootstrap complete: Monitoring ${addresses.length} addresses`);
      this.isListenerStarted = true;

      // Clear retry interval if it exists
      if (this.retryInterval) {
        clearInterval(this.retryInterval);
        this.retryInterval = null;
      }
    } catch (error) {
      console.error('❌ Bootstrap failed:', error.message);
      console.log('💡 Make sure Laravel is running and LARAVEL_URL is correct');
      console.log('🔄 Will retry in 5 minutes...');
      this.scheduleRetry();
    }
  }

  /**
   * Schedule retry after 5 minutes
   */
  private scheduleRetry() {
    // Prevent multiple retry intervals
    if (this.retryInterval) {
      return;
    }

    this.retryInterval = setInterval(() => {
      console.log('🔄 Retrying to fetch addresses from Laravel...');
      this.tryFetchAndStartListener();
    }, 300000); // 5 minutes
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

      // Support both response formats: {addresses: [...]} or {data: [...]}
      const addresses = response.data.addresses || response.data.data || [];
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

    // Mark listener as started if registerAddress started it
    if (!this.isListenerStarted) {
      this.isListenerStarted = true;

      // Clear retry interval if it exists
      if (this.retryInterval) {
        clearInterval(this.retryInterval);
        this.retryInterval = null;
        console.log('✅ Listener started via manual registration - stopping retry attempts');
      }
    }
  }
}
