import { Controller, Post, Body, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiExcludeEndpoint } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { EncryptionService, EncryptedData } from '../encryption/encryption.service';
import { BootstrapService } from '../listener/bootstrap.service';
import { ConfigService } from '@nestjs/config';
import {
  GenerateMnemonicResponseDto,
  GetAddressRequestDto,
  GetAddressResponseDto,
  ValidateAddressRequestDto,
  ValidateAddressResponseDto,
  ValidateMnemonicRequestDto,
  ValidateMnemonicResponseDto,
} from './dto/wallet.dto';

@ApiTags('Laravel Integration')
@Controller('wallet')
export class WalletController {
  private masterPassword: string;

  constructor(
    private walletService: WalletService,
    private encryptionService: EncryptionService,
    private bootstrapService: BootstrapService,
    private configService: ConfigService,
  ) {
    this.masterPassword = this.configService.get('MASTER_PASSWORD');
  }

  /**
   * Generate a new mnemonic
   * POST /wallet/generate-mnemonic
   */
  @Post('generate-mnemonic')
  @ApiOperation({
    summary: '1. Generate Master Mnemonic (One-Time Setup)',
    description:
      'Generate encrypted BIP39 mnemonic for your application.\n\n' +
      '**IMPORTANT:** Run this ONCE during initial Laravel setup.\n\n' +
      'Steps:\n' +
      '1. Call this endpoint to generate encrypted mnemonic\n' +
      '2. Store the entire `encrypted_mnemonic` object in Laravel database\n' +
      '3. Use the same mnemonic for all user address generation\n\n' +
      'Security: Mnemonic is encrypted with AES-256-GCM using MASTER_PASSWORD.',
  })
  @ApiResponse({
    status: 200,
    description: 'Encrypted mnemonic generated successfully',
    type: GenerateMnemonicResponseDto,
  })
  generateMnemonic(@Body('word_count') wordCount?: 12 | 24) {
    const mnemonic = this.walletService.generateMnemonic(wordCount || 12);
    const encrypted = this.encryptionService.encrypt(mnemonic, this.masterPassword);

    return {
      success: true,
      encrypted_mnemonic: encrypted,
      message: 'Mnemonic generated and encrypted. Store this securely in Laravel database.',
    };
  }

  /**
   * Get address for user (generate if not exists)
   * POST /wallet/get-address
   */
  @Post('get-address')
  async getAddressForUser(
    @Body('encrypted_mnemonic') encryptedMnemonic: EncryptedData,
    @Body('index') index: number,
    @Body('user_id') userId?: number,
  ) {
    try {
      // Decrypt mnemonic
      const mnemonic = this.encryptionService.decrypt(encryptedMnemonic, this.masterPassword);

      // Derive address
      const addressData = this.walletService.deriveAddress(mnemonic, index);

      // Auto-register with listener if user_id provided
      if (userId) {
        await this.bootstrapService.registerNewAddress(userId, addressData.address);
      }

      return {
        success: true,
        address: addressData.address,
        index: addressData.index,
        derivation_path: addressData.derivationPath,
        monitoring: userId ? true : false,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Validate mnemonic
   * POST /wallet/validate-mnemonic
   */
  @Post('validate-mnemonic')
  validateMnemonic(@Body('mnemonic') mnemonic: string) {
    const isValid = this.walletService.validateMnemonic(mnemonic);

    return {
      success: true,
      is_valid: isValid,
    };
  }

  /**
   * Get master public key (for watch-only wallets)
   * POST /wallet/master-public-key
   */
  @Post('master-public-key')
  getMasterPublicKey(@Body('encrypted_mnemonic') encryptedMnemonic: EncryptedData) {
    try {
      const mnemonic = this.encryptionService.decrypt(encryptedMnemonic, this.masterPassword);
      const xpub = this.walletService.getMasterPublicKey(mnemonic);

      return {
        success: true,
        xpub: xpub,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Validate TRON address format
   * POST /wallet/validate-address
   */
  @Post('validate-address')
  validateAddress(@Body('address') address: string) {
    const isValid = this.walletService.isValidAddress(address);

    return {
      success: true,
      is_valid: isValid,
    };
  }

  /**
   * Health check
   * GET /wallet/health
   */
  @Get('health')
  health() {
    return {
      success: true,
      service: 'TRX Wallet Service',
      network: 'TRON',
      status: 'operational',
    };
  }
}
