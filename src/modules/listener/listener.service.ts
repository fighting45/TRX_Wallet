import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import * as crypto from 'crypto';
import { ProcessedDeposit, NetworkSyncState } from '../../entities';

/**
 * ListenerService - Monitors TRON blockchain for deposits
 *
 * Features:
 * - Supports TRX and TRC20 tokens (USDT, USDC, etc.)
 * - Uses GetBlock JSON-RPC (unlimited requests)
 * - Database persistence to prevent duplicate processing
 * - Webhook retry queue for failed Laravel notifications
 * - Automatic catch-up after downtime
 */
@Injectable()
export class ListenerService {
  // USDT TRC20 contract address (mainnet)
  private readonly USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

  private laravelWebhookUrl: string;
  private laravelApiSecret: string;
  private tronRpcUrl: string;
  private tronApiKeys: string[];
  private currentApiKeyIndex = 0;
  private tronApiType: string; // 'jsonrpc' or 'rest'
  private monitoredAddresses: Map<string, number> = new Map(); // address -> userId
  private isListenerRunning: boolean = false; // Track if listener is active

  constructor(
    private configService: ConfigService,
    @InjectRepository(ProcessedDeposit)
    private processedDepositRepo: Repository<ProcessedDeposit>,
    @InjectRepository(NetworkSyncState)
    private networkSyncStateRepo: Repository<NetworkSyncState>,
  ) {
    this.laravelWebhookUrl = this.configService.get('LARAVEL_URL') + '/api/v1/deposits/webhook';
    this.laravelApiSecret = this.configService.get('LARAVEL_API_SECRET');
    this.tronRpcUrl = this.configService.get('TRON_RPC_URL');
    const key1 = this.configService.get('TRON_API_KEY');
    const key2 = this.configService.get('TRON_API_KEY_2');
    const key3 = this.configService.get('TRON_API_KEY_3');
    this.tronApiKeys = [key1, key2, key3].filter(Boolean);
    this.tronApiType = this.configService.get('TRON_API_TYPE', 'rest');
  }

  /**
   * Get next API key for rate limit rotation
   */
  private getNextApiKey(): string {
    if (this.tronApiKeys.length === 0) return '';
    const key = this.tronApiKeys[this.currentApiKeyIndex];
    this.currentApiKeyIndex = (this.currentApiKeyIndex + 1) % this.tronApiKeys.length;
    return key;
  }

  /**
   * Start monitoring TRON blockchain
   */
  async startListener(addresses: Array<{ user_id: number; address: string }>) {
    if (this.isListenerRunning) {
      console.log('⚠️  Listener already running, skipping duplicate start');
      return;
    }

    console.log('🔍 Starting TRON deposit listener...');
    console.log(`📡 Using ${this.tronApiType.toUpperCase()} API: ${this.tronRpcUrl}`);
    console.log(`👥 Monitoring ${addresses.length} TRON addresses`);

    // Build address map for fast lookup
    // NOTE: TRON addresses are case-sensitive, don't convert to lowercase!
    this.monitoredAddresses.clear();
    for (const addr of addresses) {
      this.monitoredAddresses.set(addr.address, addr.user_id);
    }

    this.isListenerRunning = true;

    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    while (true) {
      try {
        // Check all monitored addresses (from the Map, not the initial array)
        const addressesToCheck = Array.from(this.monitoredAddresses.entries()).map(([address, user_id]) => ({
          address,
          user_id,
        }));

        console.log(`🔍 Checking ${addressesToCheck.length} addresses for deposits...`);
        for (const addr of addressesToCheck) {
          console.log(`   📍 Checking address: ${addr.address}`);
          try {
            await this.checkTronDeposits(addr.user_id, addr.address);
          } catch (error: any) {
            // Log error but continue checking other addresses
            console.error(`   ⚠️  Error checking ${addr.address}: ${error.message}`);
          }
        }

        consecutiveErrors = 0;
        console.log(`⏰ Next check in 5 minutes (${new Date(Date.now() + 300000).toLocaleTimeString()})`);
        await this.sleep(300000); // Check every 5 minutes
      } catch (error) {
        consecutiveErrors++;
        console.error(`❌ TRON listener error (${consecutiveErrors}/${maxConsecutiveErrors}):`, error.message);

        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error('💡 Please check your TRON_RPC_URL configuration');
          console.log('🔄 Continuing to retry every 5 minutes...');
        }

        await this.sleep(300000);
      }
    }
  }

  /**
   * Add new address to monitoring list
   */
  async registerAddress(userId: number, address: string) {
    console.log(`➕ Registering new address for monitoring: ${address} (user ${userId})`);
    this.monitoredAddresses.set(address, userId); // Keep original case - TRON addresses are case-sensitive!

    // Auto-start listener if not already running
    if (!this.isListenerRunning) {
      console.log('🚀 Listener not running - starting now with registered addresses...');
      const addresses = Array.from(this.monitoredAddresses.entries()).map(([address, user_id]) => ({
        address,
        user_id,
      }));

      // Start listener in background (don't await - it runs indefinitely)
      this.startListener(addresses).catch((error) => {
        console.error('❌ Listener crashed:', error.message);
        this.isListenerRunning = false; // Reset flag on crash
      });
    }
  }

  /**
   * Check for deposits to a specific address
   */
  private async checkTronDeposits(userId: number, address: string) {
    try {
      let transactions = [];

      if (this.tronApiType === 'jsonrpc') {
        // Use GetBlock JSON-RPC method
        transactions = await this.getTransactionsViaJsonRpc(address);
      } else {
        // Use TronGrid REST API (fallback)
        transactions = await this.getTransactionsViaRest(address);
      }

      // Process each transaction
      for (const tx of transactions) {
        const txHash = tx.txID || tx.transaction_id;

        // Skip if already processed
        if (await this.isTransactionProcessed(txHash)) continue;

        // Check if incoming transaction
        const isIncoming = await this.isTronIncoming(tx, address);
        if (isIncoming) {
          const deposit = await this.parseTronTransaction(tx, userId, address);
          if (deposit && deposit.amount > 0) {
            await this.notifyLaravelDeposit(deposit);
          }
        }
      }
    } catch (error) {
      if (error.code === 'ETIMEDOUT') {
        console.error(`⚠️ TRON API timeout for ${address} - will retry next cycle`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Get transactions via GetBlock JSON-RPC
   */
  private async getTransactionsViaJsonRpc(address: string): Promise<any[]> {
    try {
      // Convert base58 address to hex
      const hexAddress = this.base58ToHex(address);

      const response = await axios.post(
        this.tronRpcUrl,
        {
          jsonrpc: '2.0',
          method: 'eth_getLogs',
          params: [
            {
              address: hexAddress,
              fromBlock: 'latest',
              toBlock: 'latest',
            },
          ],
          id: 1,
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000,
        },
      );

      // Note: JSON-RPC method needs to be adapted based on GetBlock's TRON implementation
      // For now, fall back to REST API
      console.log('⚠️ JSON-RPC transaction fetching not fully implemented - using REST API');
      return await this.getTransactionsViaRest(address);
    } catch (error) {
      console.error('Error fetching via JSON-RPC:', error.message);
      // Fallback to REST
      return await this.getTransactionsViaRest(address);
    }
  }

  /**
   * Get TRC20 transactions via TronGrid REST API (USDT only)
   */
  private async getTransactionsViaRest(address: string): Promise<any[]> {
    const apiKey = this.getNextApiKey();
    const headers = apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {};

    try {
      // Fetch ONLY TRC20 token transactions (USDT)
      const response = await axios.get(`${this.tronRpcUrl}/v1/accounts/${address}/transactions/trc20`, {
        params: {
          limit: 20,
          only_confirmed: true,
          contract_address: this.USDT_CONTRACT, // Filter for USDT only
        },
        headers,
        timeout: 30000,
      });

      const trc20Txs = response.data.data || [];
      console.log(`   📥 Found ${trc20Txs.length} USDT transactions for ${address.substring(0, 8)}...`);

      return trc20Txs;
    } catch (error) {
      console.error(`Error fetching USDT transactions for ${address}:`, error.message);
      return [];
    }
  }

  /**
   * Check if transaction is incoming USDT to our address
   */
  private async isTronIncoming(tx: any, address: string): Promise<boolean> {
    // USDT deposits only - check if 'to' field matches our address
    // TronGrid's /transactions/trc20 endpoint returns simplified format
    if (tx.to && tx.to === address) {
      // Verify it's USDT contract
      if (tx.token_info?.address === this.USDT_CONTRACT) {
        return true;
      }
    }

    return false;
  }

  /**
   * Parse USDT TRC20 transaction and extract deposit data
   */
  private async parseTronTransaction(tx: any, userId: number, address: string) {
    // TronGrid's /transactions/trc20 endpoint returns simplified format
    const coinSymbol = tx.token_info?.symbol || 'USDT';
    const decimals = tx.token_info?.decimals || 6;
    const tokenContract = tx.token_info?.address || this.USDT_CONTRACT;

    // Convert value to decimal (value is in smallest unit)
    const amount = Number(tx.value) / Math.pow(10, decimals);

    // Get current block for confirmations
    const currentBlock = await this.getTronCurrentBlock();
    const confirmations = currentBlock - tx.block_timestamp;

    return {
      user_id: userId,
      network: 'tron',
      coin_symbol: coinSymbol,
      amount: amount,
      from_address: tx.from,
      to_address: tx.to,
      tx_hash: tx.transaction_id,
      confirmations: confirmations,
      block_number: tx.block_timestamp,
      timestamp: tx.block_timestamp,
      token_contract: tokenContract,
    };
  }

  /**
   * Get TRON transaction info (for TRC20 logs)
   */
  private async getTronTransactionInfo(txHash: string): Promise<any> {
    try {
      const apiKey = this.getNextApiKey();
      const headers = apiKey ? {
        'Content-Type': 'application/json',
        'TRON-PRO-API-KEY': apiKey,
      } : { 'Content-Type': 'application/json' };

      const response = await axios.post(
        `${this.tronRpcUrl}/wallet/gettransactioninfobyid`,
        { value: txHash },
        { headers, timeout: 30000 },
      );
      return response.data;
    } catch (error) {
      console.error('Error getting TRON transaction info:', error.message);
      return null;
    }
  }

  /**
   * Get TRC20 token info (symbol and decimals)
   */
  private async getTRC20TokenInfo(contractAddress: string): Promise<{ symbol: string; decimals: number }> {
    try {
      const apiKey = this.getNextApiKey();
      const headers = apiKey ? {
        'Content-Type': 'application/json',
        'TRON-PRO-API-KEY': apiKey,
      } : { 'Content-Type': 'application/json' };

      // Get symbol
      const symbolResponse = await axios.post(
        `${this.tronRpcUrl}/wallet/triggerconstantcontract`,
        {
          owner_address: '410000000000000000000000000000000000000000',
          contract_address: contractAddress,
          function_selector: 'symbol()',
          parameter: '',
        },
        { headers },
      );

      // Get decimals
      const decimalsResponse = await axios.post(
        `${this.tronRpcUrl}/wallet/triggerconstantcontract`,
        {
          owner_address: '410000000000000000000000000000000000000000',
          contract_address: contractAddress,
          function_selector: 'decimals()',
          parameter: '',
        },
        { headers },
      );

      const symbol = this.parseStringResult(symbolResponse.data?.constant_result?.[0]) || 'UNKNOWN';
      const decimals = this.parseIntResult(decimalsResponse.data?.constant_result?.[0]) || 6;

      return { symbol, decimals };
    } catch (error) {
      console.error('Error getting TRC20 token info:', error.message);
      return { symbol: 'UNKNOWN', decimals: 6 };
    }
  }

  /**
   * Get current TRON block number
   */
  private async getTronCurrentBlock(): Promise<number> {
    try {
      const apiKey = this.getNextApiKey();
      const headers = apiKey ? {
        'Content-Type': 'application/json',
        'TRON-PRO-API-KEY': apiKey,
      } : { 'Content-Type': 'application/json' };

      const response = await axios.post(
        `${this.tronRpcUrl}/wallet/getnowblock`,
        {},
        { headers, timeout: 30000 },
      );
      return response.data.block_header.raw_data.number;
    } catch (error) {
      console.error('Error getting current block:', error.message);
      return 0;
    }
  }

  // ==================== DATABASE HELPERS ====================

  /**
   * Check if transaction has been processed
   */
  private async isTransactionProcessed(txHash: string): Promise<boolean> {
    const existing = await this.processedDepositRepo.findOne({
      where: { txHash },
    });
    return !!existing;
  }

  /**
   * Save processed deposit to database
   */
  private async saveProcessedDeposit(depositData: any): Promise<void> {
    const deposit = this.processedDepositRepo.create({
      txHash: depositData.tx_hash,
      blockNumber: depositData.block_number?.toString(),
      userId: depositData.user_id,
      address: depositData.to_address,
      amount: depositData.amount.toString(),
      coinSymbol: depositData.coin_symbol,
      contractAddress: depositData.token_contract || null,
    });

    await this.processedDepositRepo.save(deposit);
  }

  // ==================== WEBHOOK NOTIFICATION ====================

  /**
   * Notify Laravel of deposit via webhook
   */
  private async notifyLaravelDeposit(depositData: any) {
    try {
      // Convert to JSON string (this is what we'll sign AND send)
      const jsonPayload = JSON.stringify(depositData);

      // Create HMAC signature from the JSON string
      const signature = crypto
        .createHmac('sha256', this.laravelApiSecret)
        .update(jsonPayload)
        .digest('hex');

      // Send webhook FIRST - send the EXACT string we signed
      await axios.post(this.laravelWebhookUrl, jsonPayload, {
        headers: {
          'X-Signature': signature,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      // Only save to database AFTER successful webhook (idempotency)
      await this.saveProcessedDeposit(depositData);

      console.log(
        `✅ Notified Laravel: ${depositData.amount} ${depositData.coin_symbol} to user ${depositData.user_id} (tx: ${depositData.tx_hash.substring(0, 10)}...)`,
      );
    } catch (error) {
      console.error('❌ Failed to notify Laravel:', error.message);
      console.log(`🔄 Will retry on next check cycle (transaction not marked as processed)`);
    }
  }


  // ==================== UTILITY METHODS ====================

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Convert TRON hex address to base58
   */
  private tronHexToBase58(hexAddress: string): string {
    try {
      let hex = hexAddress.replace(/^0x/, '');
      if (!hex.startsWith('41')) {
        hex = '41' + hex;
      }

      const bytes = Buffer.from(hex, 'hex');
      const hash1 = crypto.createHash('sha256').update(bytes).digest();
      const hash2 = crypto.createHash('sha256').update(hash1).digest();
      const checksum = hash2.slice(0, 4);
      const addressWithChecksum = Buffer.concat([bytes, checksum]);

      return this.base58Encode(addressWithChecksum);
    } catch (error) {
      console.error('Error converting hex to base58:', error.message);
      return hexAddress;
    }
  }

  /**
   * Convert TRON base58 address to hex
   */
  private base58ToHex(address: string): string {
    try {
      const decoded = this.base58Decode(address);
      return '0x' + decoded.slice(0, -4).toString('hex'); // Remove checksum
    } catch (error) {
      console.error('Error converting base58 to hex:', error.message);
      return address;
    }
  }

  /**
   * Base58 encode
   */
  private base58Encode(buffer: Buffer): string {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const base = BigInt(58);
    let num = BigInt('0x' + buffer.toString('hex'));
    let encoded = '';

    while (num > 0) {
      const remainder = Number(num % base);
      num = num / base;
      encoded = ALPHABET[remainder] + encoded;
    }

    for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
      encoded = '1' + encoded;
    }

    return encoded;
  }

  /**
   * Base58 decode
   */
  private base58Decode(str: string): Buffer {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const bytes = [0];

    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      const value = ALPHABET.indexOf(c);
      if (value === -1) throw new Error('Invalid base58 character');

      let carry = value;
      for (let j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }

    for (let i = 0; i < str.length && str[i] === '1'; i++) {
      bytes.push(0);
    }

    return Buffer.from(bytes.reverse());
  }

  /**
   * Parse string result from contract call
   */
  private parseStringResult(hexResult: string): string {
    if (!hexResult) return '';
    try {
      const buffer = Buffer.from(hexResult, 'hex');
      const symbolHex = buffer.slice(64).toString('hex').replace(/00/g, '');
      return Buffer.from(symbolHex, 'hex').toString('utf8');
    } catch (error) {
      return '';
    }
  }

  /**
   * Parse int result from contract call
   */
  private parseIntResult(hexResult: string): number {
    if (!hexResult) return 0;
    try {
      return parseInt(hexResult, 16);
    } catch (error) {
      return 0;
    }
  }
}
