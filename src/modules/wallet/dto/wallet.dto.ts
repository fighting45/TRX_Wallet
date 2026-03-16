import { ApiProperty } from '@nestjs/swagger';

export class EncryptedDataDto {
  @ApiProperty({
    description: 'AES-256-GCM encrypted data',
    example: 'f9396b05abeb1037fc6aa3ab017ae10dadd94900f805a005a5ff362cf4e0b4cf...',
  })
  encrypted: string;

  @ApiProperty({
    description: 'Initialization vector for decryption',
    example: 'b88c7c185a2012327dc11caec3d7e9fd',
  })
  iv: string;

  @ApiProperty({
    description: 'Salt used for key derivation',
    example: '2bfd374a44fa761eb54f9964dbc12778ce5e757e50f5fbd9efe25b8183d854bf',
  })
  salt: string;

  @ApiProperty({
    description: 'Authentication tag for data integrity',
    example: '372341bb8cd9b0667937fbe68650be07',
  })
  authTag: string;
}

export class GenerateMnemonicResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ type: EncryptedDataDto })
  encrypted_mnemonic: EncryptedDataDto;

  @ApiProperty({
    example: 'Mnemonic generated and encrypted. Store this securely in Laravel database.',
  })
  message: string;
}

export class GetAddressRequestDto {
  @ApiProperty({
    description: 'Encrypted mnemonic from Laravel database',
    type: EncryptedDataDto,
  })
  encrypted_mnemonic: EncryptedDataDto;

  @ApiProperty({
    description: 'Derivation index (incremental per user)',
    example: 0,
    minimum: 0,
  })
  index: number;

  @ApiProperty({
    description: 'Laravel user ID (required for auto-monitoring)',
    example: 1,
    required: true,
  })
  user_id: number;
}

export class GetAddressResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({
    description: 'Generated TRON address',
    example: 'TW6nF3VcaNgjWsxCHJ6F1PqHiynSxfP5KK',
  })
  address: string;

  @ApiProperty({
    description: 'Derivation index used',
    example: 0,
  })
  index: number;

  @ApiProperty({
    description: 'BIP44 derivation path',
    example: "m/44'/195'/0'/0/0",
  })
  derivation_path: string;

  @ApiProperty({
    description: 'Whether address is being monitored for deposits',
    example: true,
  })
  monitoring: boolean;
}

export class ValidateAddressRequestDto {
  @ApiProperty({
    description: 'TRON address to validate',
    example: 'TW6nF3VcaNgjWsxCHJ6F1PqHiynSxfP5KK',
  })
  address: string;
}

export class ValidateAddressResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: true })
  valid: boolean;

  @ApiProperty({
    example: 'TW6nF3VcaNgjWsxCHJ6F1PqHiynSxfP5KK',
  })
  address: string;
}

export class ValidateMnemonicRequestDto {
  @ApiProperty({
    description: '12 or 24 word BIP39 mnemonic phrase',
    example: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  })
  mnemonic: string;
}

export class ValidateMnemonicResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: true })
  valid: boolean;
}

export class DepositWebhookDto {
  @ApiProperty({
    description: 'Laravel user ID',
    example: 1,
  })
  user_id: number;

  @ApiProperty({
    description: 'Deposit address',
    example: 'TW6nF3VcaNgjWsxCHJ6F1PqHiynSxfP5KK',
  })
  address: string;

  @ApiProperty({
    description: 'Deposit amount (decimal)',
    example: '100.50',
  })
  amount: string;

  @ApiProperty({
    description: 'Coin symbol (TRX or USDT)',
    example: 'USDT',
  })
  coin_symbol: string;

  @ApiProperty({
    description: 'TRC20 contract address (null for native TRX)',
    example: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    nullable: true,
  })
  contract_address: string | null;

  @ApiProperty({
    description: 'Transaction hash',
    example: 'abc123def456...',
  })
  tx_hash: string;

  @ApiProperty({
    description: 'Block number',
    example: 58123456,
  })
  block_number: number;

  @ApiProperty({
    description: 'Block timestamp',
    example: 1710614400,
  })
  block_timestamp: number;

  @ApiProperty({
    description: 'Number of confirmations',
    example: 19,
  })
  confirmations: number;
}
