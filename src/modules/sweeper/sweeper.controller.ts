import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiParam } from '@nestjs/swagger';
import { SweeperService } from './sweeper.service';
import { WalletService } from '../wallet/wallet.service';
import { EncryptionService } from '../encryption/encryption.service';
import { ConfigService } from '@nestjs/config';
import {
  EstimateSweepDto,
  ExecuteSweepDto,
  EstimateSweepResponseDto,
  ExecuteSweepResponseDto,
  SweepStatusResponseDto,
} from './dto/sweeper.dto';

@ApiTags('Sweeper Service')
@Controller('sweeper')
export class SweeperController {
  private masterPassword: string;

  constructor(
    private sweeperService: SweeperService,
    private walletService: WalletService,
    private encryptionService: EncryptionService,
    private configService: ConfigService,
  ) {
    this.masterPassword = this.configService.get('MASTER_PASSWORD');
  }

  @Post('estimate')
  @ApiOperation({
    summary: '1. Estimate Sweep Costs',
    description:
      'Scan HD wallet addresses for USDT balances and estimate TRX costs.\n\n' +
      '**Process:**\n' +
      '1. Scans addresses from start_index to end_index\n' +
      '2. Identifies addresses with USDT balance >= min_balance\n' +
      '3. Determines if each wallet is empty (first USDT) or non-empty\n' +
      '4. Calculates TRX required: 7.5 TRX per address (~$2.25)\n' +
      '   - All addresses have USDT balance (non-empty wallets)\n' +
      '   - Actual cost: ~6.7 TRX, sending 7.5 TRX (12% buffer)\n\n' +
      '**Returns:**\n' +
      '- List of addresses to sweep with individual costs\n' +
      '- Total USDT amount\n' +
      '- Admin wallet TRX balance\n' +
      '- Total TRX required\n' +
      '- Whether admin has sufficient balance',
  })
  @ApiBody({ type: EstimateSweepDto })
  @ApiResponse({
    status: 200,
    description: 'Estimation completed successfully',
    type: EstimateSweepResponseDto,
  })
  async estimateSweep(@Body() dto: EstimateSweepDto) {
    try {
      console.log(`📊 Estimating sweep from index ${dto.start_index || 0} to ${dto.end_index || 100}...`);

      // Decrypt mnemonic
      const mnemonic = this.encryptionService.decrypt(dto.encrypted_mnemonic, this.masterPassword);

      // Scan addresses for balances
      const addressesWithBalance = await this.sweeperService.scanAddressesForBalance(
        mnemonic,
        dto.start_index || 0,
        dto.end_index || 100,
        dto.min_balance || 0,
      );

      // Calculate totals
      const totalUsdt = addressesWithBalance.reduce((sum, addr) => sum + parseFloat(addr.balance), 0);
      const addressCount = addressesWithBalance.length;
      const totalTrxFee = addressCount * 7.5; // 7.5 TRX per address (all are non-empty with USDT)

      // Get admin wallet TRX balance
      const adminTrxBalance = await this.sweeperService.getAdminWalletTrxBalance();

      const adminAddress = this.configService.get('ADMIN_WALLET_ADDRESS');

      return {
        success: true,
        addresses_to_sweep: addressesWithBalance.map((addr) => ({
          address: addr.address,
          index: addr.index,
          usdt_balance: addr.balance,
        })),
        total_usdt: totalUsdt.toFixed(6),
        admin_address: adminAddress,
        admin_trx_balance: adminTrxBalance.toFixed(2),
        total_trx_required: totalTrxFee.toFixed(2),
        trx_per_address: 7.5,
        address_count: addressCount,
        sufficient_balance: adminTrxBalance >= totalTrxFee,
      };
    } catch (error) {
      console.error(`❌ Estimate failed:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  @Post('execute')
  @ApiOperation({
    summary: '2. Execute Sweep',
    description:
      'Execute USDT sweep from multiple addresses to admin wallet.\n\n' +
      '**Process:**\n' +
      '1. Validates confirm=true flag\n' +
      '2. Decrypts mnemonic and derives private keys\n' +
      '3. For each address sequentially:\n' +
      '   a. Admin sends TRX to source address for gas\n' +
      '   b. Waits for TRX transfer confirmation (~3 sec)\n' +
      '   c. Source address transfers USDT to admin\n' +
      '   d. Saves transaction to database\n\n' +
      '**Fee Payment:**\n' +
      '- Admin wallet pays all gas costs (sends TRX first)\n' +
      '- Source addresses receive TRX temporarily for gas\n' +
      '- Gas is burned during USDT transfer\n' +
      '- No staking required, just sufficient TRX balance\n\n' +
      '**Cost per address:**\n' +
      '- Fixed: 7.5 TRX per address (~$2.25 @ $0.30/TRX)\n' +
      '- Actual consumption: ~6.7 TRX (12% buffer included)\n' +
      '- All addresses are non-empty (have USDT balance)\n\n' +
      '**Returns:**\n' +
      '- Transaction hashes for each sweep\n' +
      '- Success/failure status per address\n' +
      '- Total USDT swept',
  })
  @ApiBody({ type: ExecuteSweepDto })
  @ApiResponse({
    status: 200,
    description: 'Sweep execution completed',
    type: ExecuteSweepResponseDto,
  })
  async executeSweep(@Body() dto: ExecuteSweepDto) {
    try {
      // Validate confirmation
      if (dto.confirm !== true) {
        return {
          success: false,
          error: 'Confirmation required. Set confirm=true to execute sweep.',
        };
      }

      console.log(`🚀 Executing sweep for ${dto.addresses.length} addresses...`);

      // Decrypt mnemonic
      const mnemonic = this.encryptionService.decrypt(dto.encrypted_mnemonic, this.masterPassword);

      const transactions = [];
      const failedAddresses = [];
      let totalSwept = 0;

      // Process each address sequentially
      for (const addr of dto.addresses) {
        try {
          console.log(`\n🔄 Processing ${addr.address}...`);

          // Derive private key
          const addressData = this.walletService.deriveAddress(mnemonic, addr.index);

          // Get current balance
          const balance = await this.sweeperService['getUsdtBalance'](addr.address);

          if (balance === 0) {
            console.log(`⚠️  Address has zero balance, skipping`);
            failedAddresses.push({
              address: addr.address,
              error: 'Zero USDT balance',
            });
            continue;
          }

          // Execute sweep
          const result = await this.sweeperService.sweepAddress(
            addr.address,
            addr.index,
            balance.toFixed(6),
            addressData.privateKey,
          );

          if (result.status === 'failed') {
            failedAddresses.push({
              address: addr.address,
              error: result.error || 'Unknown error',
            });
          } else {
            transactions.push({
              from_address: addr.address,
              tx_hash: result.txHash,
              delegation_tx_hash: result.delegationTxHash,
              usdt_amount: balance.toFixed(6),
              status: result.status,
            });
            totalSwept += balance;
          }

          // Small delay between addresses
          await this.sleep(2000);
        } catch (error) {
          console.error(`❌ Failed to sweep ${addr.address}: ${error.message}`);
          failedAddresses.push({
            address: addr.address,
            error: error.message,
          });
        }
      }

      console.log(`\n✅ Sweep execution completed!`);
      console.log(`   Successfully swept: ${transactions.length} addresses`);
      console.log(`   Failed: ${failedAddresses.length} addresses`);
      console.log(`   Total USDT: ${totalSwept.toFixed(6)}`);

      return {
        success: true,
        total_swept: totalSwept.toFixed(6),
        transactions,
        failed_addresses: failedAddresses,
        success_count: transactions.length,
        failed_count: failedAddresses.length,
      };
    } catch (error) {
      console.error(`❌ Execute failed:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  @Get('status/:txHash')
  @ApiOperation({
    summary: '3. Check Sweep Status',
    description:
      'Check the status of a sweep transaction.\n\n' +
      '**Returns:**\n' +
      '- Transaction details\n' +
      '- Current status (pending/confirmed/failed)\n' +
      '- Energy usage\n' +
      '- Error message if failed',
  })
  @ApiParam({
    name: 'txHash',
    description: 'Transaction hash to check',
    example: 'abc123def456...',
  })
  @ApiResponse({
    status: 200,
    description: 'Status retrieved successfully',
    type: SweepStatusResponseDto,
  })
  async getSweepStatus(@Param('txHash') txHash: string) {
    try {
      const transaction = await this.sweeperService.getSweepStatus(txHash);

      if (!transaction) {
        return {
          success: false,
          error: 'Transaction not found',
        };
      }

      return {
        success: true,
        transaction: {
          tx_hash: transaction.txHash,
          status: transaction.status,
          from_address: transaction.fromAddress,
          to_address: transaction.toAddress,
          usdt_amount: transaction.usdtAmount,
          funding_tx_hash: transaction.delegationTxHash, // TRX funding transaction
          block_number: transaction.blockNumber,
          created_at: transaction.createdAt,
          error_message: transaction.errorMessage,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
