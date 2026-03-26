import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { WalletService } from '../wallet/wallet.service';
import { EncryptionService } from '../encryption/encryption.service';
import { SweepTransaction } from '../../entities/sweep-transaction.entity';
import { TronWeb } from 'tronweb';
import axios from 'axios';

interface AddressWithBalance {
  address: string;
  index: number;
  balance: string;
}

interface SweepResult {
  txHash: string;
  delegationTxHash: string;
  status: string;
  error?: string;
}

@Injectable()
export class SweeperService implements OnModuleInit {
  private readonly logger = new Logger(SweeperService.name);
  private adminWalletAddress: string;
  private adminWalletPrivateKey: string;
  private tronRpcUrl: string;
  private tronApiKeys: string[] = [];
  private currentApiKeyIndex = 0;
  private readonly USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  private readonly USDT_DECIMALS = 6;
  private readonly TRX_FEE_PER_SWEEP = 7.5; // TRX needed per sweep (~6.7 TRX actual + 12% buffer)
  private readonly FEE_LIMIT = 20_000_000; // 20 TRX fee limit (3x actual cost)

  constructor(
    @InjectRepository(SweepTransaction)
    private sweepTransactionRepository: Repository<SweepTransaction>,
    private walletService: WalletService,
    private encryptionService: EncryptionService,
    private configService: ConfigService,
  ) {
    this.adminWalletAddress = this.configService.get<string>('ADMIN_WALLET_ADDRESS');
    this.adminWalletPrivateKey = this.configService.get<string>('ADMIN_WALLET_PRIVATE_KEY');
    this.tronRpcUrl = this.configService.get<string>('TRON_RPC_URL', 'https://api.trongrid.io');

    // Load API keys
    const key1 = this.configService.get<string>('TRON_API_KEY');
    const key2 = this.configService.get<string>('TRON_API_KEY_2');
    const key3 = this.configService.get<string>('TRON_API_KEY_3');
    if (key1) this.tronApiKeys.push(key1);
    if (key2) this.tronApiKeys.push(key2);
    if (key3) this.tronApiKeys.push(key3);
  }

  async onModuleInit() {
    // Validate admin wallet address
    if (!this.adminWalletAddress) {
      this.logger.warn('⚠️  ADMIN_WALLET_ADDRESS not configured - sweeper will not work');
      return;
    }

    if (!this.walletService.isValidAddress(this.adminWalletAddress)) {
      throw new Error(`Invalid ADMIN_WALLET_ADDRESS: ${this.adminWalletAddress}`);
    }

    if (!this.adminWalletPrivateKey) {
      this.logger.warn('⚠️  ADMIN_WALLET_PRIVATE_KEY not configured - sweeper will not work');
      return;
    }

    this.logger.log(`✅ Sweeper initialized with admin address: ${this.adminWalletAddress}`);
  }

  private getNextApiKey(): string {
    if (this.tronApiKeys.length === 0) return '';
    const key = this.tronApiKeys[this.currentApiKeyIndex];
    this.currentApiKeyIndex = (this.currentApiKeyIndex + 1) % this.tronApiKeys.length;
    return key;
  }

  /**
   * Scan addresses from HD wallet for USDT balances
   */
  async scanAddressesForBalance(
    mnemonic: string,
    startIndex: number,
    endIndex: number,
    minBalance: number = 0,
  ): Promise<AddressWithBalance[]> {
    this.logger.log(`🔍 Scanning addresses ${startIndex}-${endIndex} for USDT balances...`);

    const addressesWithBalance: AddressWithBalance[] = [];
    const batchSize = 10;

    for (let i = startIndex; i < endIndex; i += batchSize) {
      const batch: Promise<AddressWithBalance | null>[] = [];

      for (let j = i; j < Math.min(i + batchSize, endIndex); j++) {
        batch.push(this.checkAddressBalance(mnemonic, j, minBalance));
      }

      const results = await Promise.all(batch);
      addressesWithBalance.push(...results.filter((r): r is AddressWithBalance => r !== null));

      this.logger.log(`   ✓ Processed ${Math.min(i + batchSize, endIndex)}/${endIndex} addresses`);

      // Small delay to avoid rate limits
      if (i + batchSize < endIndex) {
        await this.sleep(1000);
      }
    }

    this.logger.log(`✅ Found ${addressesWithBalance.length} addresses with USDT balance >= ${minBalance}`);
    return addressesWithBalance;
  }

  /**
   * Check USDT balance for a single address
   */
  private async checkAddressBalance(
    mnemonic: string,
    index: number,
    minBalance: number,
  ): Promise<AddressWithBalance | null> {
    try {
      const addressData = this.walletService.deriveAddress(mnemonic, index);
      const balance = await this.getUsdtBalance(addressData.address);

      if (balance >= minBalance) {
        return {
          address: addressData.address,
          index,
          balance: balance.toFixed(6),
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`Error checking balance for index ${index}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get USDT balance for an address
   */
  private async getUsdtBalance(address: string): Promise<number> {
    try {
      const apiKey = this.getNextApiKey();
      const headers = apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {};

      const response = await axios.get(`${this.tronRpcUrl}/v1/accounts/${address}`, {
        headers,
        timeout: 10000,
      });

      const accountData = response.data.data?.[0];
      if (!accountData) return 0;

      if (accountData.trc20) {
        const trc20Data = Array.isArray(accountData.trc20) ? accountData.trc20 : [accountData.trc20];

        for (const tokenEntry of trc20Data) {
          for (const [contractAddress, balanceRaw] of Object.entries(tokenEntry)) {
            if (contractAddress === this.USDT_CONTRACT) {
              return Number(balanceRaw) / Math.pow(10, this.USDT_DECIMALS);
            }
          }
        }
      }

      return 0;
    } catch (error) {
      this.logger.error(`Failed to get USDT balance for ${address}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Get admin wallet TRX balance
   */
  async getAdminWalletTrxBalance(): Promise<number> {
    try {
      const apiKey = this.getNextApiKey();
      const tronWeb = new TronWeb({
        fullHost: this.tronRpcUrl,
        headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {},
      });

      const balance = await tronWeb.trx.getBalance(this.adminWalletAddress);
      return balance / 1_000_000; // Convert from SUN to TRX
    } catch (error) {
      this.logger.error(`Failed to get admin wallet TRX balance: ${error.message}`);
      return 0;
    }
  }

  /**
   * Send TRX from admin wallet to recipient address (for gas fees)
   */
  async sendTrxForGas(recipientAddress: string, amountTrx: number): Promise<string> {
    this.logger.log(`💰 Sending ${amountTrx} TRX to ${recipientAddress} for gas...`);

    try {
      const apiKey = this.getNextApiKey();
      const tronWeb = new TronWeb({
        fullHost: this.tronRpcUrl,
        headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {},
        privateKey: this.adminWalletPrivateKey,
      });

      // Convert TRX to SUN (1 TRX = 1,000,000 SUN)
      const amountSun = Math.floor(amountTrx * 1_000_000);

      // Send TRX transaction
      const tx = await tronWeb.trx.sendTransaction(recipientAddress, amountSun);

      if (!tx.result) {
        throw new Error(`TRX transfer failed: ${JSON.stringify(tx)}`);
      }

      const txHash = tx.txid || tx.transaction?.txID;
      this.logger.log(`✅ TRX transfer successful: ${txHash}`);

      // Wait for confirmation (~3 seconds per block)
      await this.sleep(3000);

      return txHash;
    } catch (error) {
      this.logger.error(`❌ TRX transfer failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Transfer USDT from source address to admin address
   */
  async transferUSDT(
    fromAddress: string,
    fromPrivateKey: string,
    toAddress: string,
    amount: string,
  ): Promise<string> {
    this.logger.log(`💸 Transferring ${amount} USDT from ${fromAddress} to ${toAddress}...`);

    try {
      const apiKey = this.getNextApiKey();
      const tronWeb = new TronWeb({
        fullHost: this.tronRpcUrl,
        headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {},
        privateKey: fromPrivateKey,
      });

      // Get USDT contract
      const contract = await tronWeb.contract().at(this.USDT_CONTRACT);

      // Convert amount to smallest unit (sun for USDT = 6 decimals)
      const amountInSun = Math.floor(parseFloat(amount) * Math.pow(10, this.USDT_DECIMALS));

      // Fee limit: 20 TRX (3x buffer over ~6.7 TRX actual cost)
      // Note: All addresses being swept already have USDT, so they're non-empty wallets
      this.logger.log(`   Fee limit: 20 TRX (non-empty wallet with USDT)`);

      // Send transaction
      const tx = await contract.methods.transfer(toAddress, amountInSun).send({
        feeLimit: this.FEE_LIMIT,
      });

      this.logger.log(`✅ USDT transfer successful: ${tx}`);
      return tx;
    } catch (error) {
      this.logger.error(`❌ USDT transfer failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Complete sweep flow for a single address
   */
  async sweepAddress(
    address: string,
    index: number,
    balance: string,
    privateKey: string,
  ): Promise<SweepResult> {
    this.logger.log(`🧹 Sweeping ${balance} USDT from ${address} (index ${index})...`);

    try {
      // Step 1: Send TRX from admin to source address for gas
      // Note: All addresses have USDT balance, so they're non-empty wallets (65k energy)
      this.logger.log(`   Sending ${this.TRX_FEE_PER_SWEEP} TRX for gas fees...`);
      const fundingTxHash = await this.sendTrxForGas(address, this.TRX_FEE_PER_SWEEP);

      // Step 2: Transfer USDT from source to admin
      const txHash = await this.transferUSDT(address, privateKey, this.adminWalletAddress, balance);

      // Step 4: Save to database
      const sweepTransaction = this.sweepTransactionRepository.create({
        txHash,
        delegationTxHash: fundingTxHash, // Repurpose field for TRX funding tx
        fromAddress: address,
        toAddress: this.adminWalletAddress,
        usdtAmount: balance,
        derivationIndex: index,
        status: 'pending',
        energyUsed: 0, // Not tracking energy anymore
      });

      await this.sweepTransactionRepository.save(sweepTransaction);

      this.logger.log(`✅ Sweep completed for ${address}`);

      return {
        txHash,
        delegationTxHash: fundingTxHash,
        status: 'pending',
      };
    } catch (error) {
      this.logger.error(`❌ Sweep failed for ${address}: ${error.message}`);

      // Try to save failed transaction
      try {
        const sweepTransaction = this.sweepTransactionRepository.create({
          txHash: 'failed_' + Date.now(),
          fromAddress: address,
          toAddress: this.adminWalletAddress,
          usdtAmount: balance,
          derivationIndex: index,
          status: 'failed',
          errorMessage: error.message,
        });

        await this.sweepTransactionRepository.save(sweepTransaction);
      } catch (dbError) {
        this.logger.error(`Failed to save error to database: ${dbError.message}`);
      }

      return {
        txHash: '',
        delegationTxHash: '',
        status: 'failed',
        error: error.message,
      };
    }
  }

  /**
   * Get sweep transaction status
   */
  async getSweepStatus(txHash: string): Promise<SweepTransaction | null> {
    return await this.sweepTransactionRepository.findOne({
      where: { txHash },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
