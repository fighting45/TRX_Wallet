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
  private readonly ENERGY_PER_TRANSFER = 65000; // For non-empty wallets

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
   * Get available energy for admin wallet
   */
  async getAdminWalletEnergy(): Promise<number> {
    try {
      const apiKey = this.getNextApiKey();
      const tronWeb = new TronWeb({
        fullHost: this.tronRpcUrl,
        headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {},
      });

      const account = await tronWeb.trx.getAccountResources(this.adminWalletAddress);
      return account.EnergyLimit || 0;
    } catch (error) {
      this.logger.error(`Failed to get admin wallet energy: ${error.message}`);
      return 0;
    }
  }

  /**
   * Delegate energy to a recipient address
   */
  async delegateEnergyToAddress(recipientAddress: string, energyAmount: number): Promise<string> {
    this.logger.log(`⚡ Delegating ${energyAmount} energy to ${recipientAddress}...`);

    try {
      const apiKey = this.getNextApiKey();
      const tronWeb = new TronWeb({
        fullHost: this.tronRpcUrl,
        headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {},
        privateKey: this.adminWalletPrivateKey,
      });

      // Build delegation transaction
      const transaction = await tronWeb.transactionBuilder.delegateResource(
        energyAmount,
        recipientAddress,
        'ENERGY',
        this.adminWalletAddress,
        false, // lock
        0, // lockPeriod
      );

      // Sign and broadcast
      const signedTx = await tronWeb.trx.sign(transaction);
      const broadcast = await tronWeb.trx.sendRawTransaction(signedTx);

      if (!broadcast.result) {
        throw new Error(`Delegation failed: ${JSON.stringify(broadcast)}`);
      }

      const txHash = broadcast.txid || broadcast.transaction?.txID;
      this.logger.log(`✅ Energy delegation successful: ${txHash}`);

      // Wait for confirmation
      await this.sleep(3000);

      return txHash;
    } catch (error) {
      this.logger.error(`❌ Energy delegation failed: ${error.message}`);
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

      // Send transaction
      const tx = await contract.methods.transfer(toAddress, amountInSun).send({
        feeLimit: 150000000, // 150 TRX fee limit
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
      // Step 1: Delegate energy
      const delegationTxHash = await this.delegateEnergyToAddress(address, this.ENERGY_PER_TRANSFER);

      // Step 2: Transfer USDT
      const txHash = await this.transferUSDT(address, privateKey, this.adminWalletAddress, balance);

      // Step 3: Save to database
      const sweepTransaction = this.sweepTransactionRepository.create({
        txHash,
        delegationTxHash,
        fromAddress: address,
        toAddress: this.adminWalletAddress,
        usdtAmount: balance,
        derivationIndex: index,
        status: 'pending',
        energyUsed: this.ENERGY_PER_TRANSFER,
      });

      await this.sweepTransactionRepository.save(sweepTransaction);

      this.logger.log(`✅ Sweep completed for ${address}`);

      return {
        txHash,
        delegationTxHash,
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
