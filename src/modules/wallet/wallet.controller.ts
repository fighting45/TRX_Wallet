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
  @ApiOperation({
    summary: '2. Generate User Deposit Address (Main Integration)',
    description:
      'Generate TRON address for a specific user.\n\n' +
      '**When to call:**\n' +
      '- User requests deposit address\n' +
      '- User wallet page loads\n\n' +
      '**How it works:**\n' +
      '1. Pass encrypted mnemonic from Laravel DB\n' +
      '2. Pass incremental index (user ID or counter)\n' +
      '3. Pass user_id to auto-enable deposit monitoring\n' +
      '4. Same index always returns same address (deterministic)\n\n' +
      '**Example Flow:**\n' +
      '- User 1 → index: 0 → Address: TW6nF...\n' +
      '- User 2 → index: 1 → Address: TRA6K...\n\n' +
      '**Auto-Monitoring:** When user_id is provided, address is automatically registered for deposit detection.',
  })
  @ApiBody({ type: GetAddressRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Address generated successfully',
    type: GetAddressResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid encrypted mnemonic or decryption failed',
    schema: {
      example: {
        success: false,
        error: 'Unsupported state or unable to authenticate data',
      },
    },
  })
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
  @ApiOperation({
    summary: '4. Validate Mnemonic (Optional Helper)',
    description:
      'Validate BIP39 mnemonic phrase.\n\n' +
      '**Use cases:**\n' +
      '- Validate user-imported mnemonics\n' +
      '- Check backup phrase validity\n\n' +
      '**Note:** Not needed for normal operations as mnemonic is auto-generated.',
  })
  @ApiBody({ type: ValidateMnemonicRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Mnemonic validation result',
    type: ValidateMnemonicResponseDto,
  })
  validateMnemonic(@Body('mnemonic') mnemonic: string) {
    const isValid = this.walletService.validateMnemonic(mnemonic);

    return {
      success: true,
      valid: isValid,
    };
  }

  /**
   * Get master public key (for watch-only wallets)
   * POST /wallet/master-public-key
   */
  @Post('master-public-key')
  @ApiExcludeEndpoint()
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
  @ApiOperation({
    summary: '3. Validate TRON Address (Optional Helper)',
    description:
      'Validate TRON address format before processing.\n\n' +
      '**Use cases:**\n' +
      '- Validate user withdrawal addresses\n' +
      '- Check address format in forms\n' +
      '- Prevent invalid address submissions\n\n' +
      '**Validation checks:**\n' +
      '- Starts with "T"\n' +
      '- Base58 format\n' +
      '- Valid checksum\n' +
      '- Length: 34 characters',
  })
  @ApiBody({ type: ValidateAddressRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Address validation result',
    type: ValidateAddressResponseDto,
  })
  validateAddress(@Body('address') address: string) {
    const isValid = this.walletService.isValidAddress(address);

    return {
      success: true,
      valid: isValid,
      address: address,
    };
  }

  /**
   * Health check
   * GET /wallet/health
   */
  @Get('health')
  @ApiExcludeEndpoint()
  health() {
    return {
      success: true,
      service: 'TRX Wallet Service',
      network: 'TRON',
      status: 'operational',
    };
  }
}
