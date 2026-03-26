import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsBoolean, IsInt, Min, ValidateNested, IsArray, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { EncryptedDataDto } from '../../wallet/dto/wallet.dto';

export class EstimateSweepDto {
  @ApiProperty({
    description: 'Encrypted mnemonic from Laravel database',
    type: EncryptedDataDto,
  })
  @ValidateNested()
  @Type(() => EncryptedDataDto)
  @IsNotEmpty()
  encrypted_mnemonic: EncryptedDataDto;

  @ApiProperty({
    description: 'Start index for address derivation',
    example: 0,
    required: false,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  start_index?: number;

  @ApiProperty({
    description: 'End index for address derivation',
    example: 100,
    required: false,
    default: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  end_index?: number;

  @ApiProperty({
    description: 'Minimum USDT balance to consider for sweep',
    example: 0,
    required: false,
    default: 0,
  })
  @IsOptional()
  @Min(0)
  min_balance?: number;
}

export class AddressToSweep {
  @ApiProperty({ example: 'TW6nF3VcaNgjWsxCHJ6F1PqHiynSxfP5KK' })
  address: string;

  @ApiProperty({ example: 5 })
  index: number;
}

export class ExecuteSweepDto {
  @ApiProperty({
    description: 'Encrypted mnemonic from Laravel database',
    type: EncryptedDataDto,
  })
  @ValidateNested()
  @Type(() => EncryptedDataDto)
  @IsNotEmpty()
  encrypted_mnemonic: EncryptedDataDto;

  @ApiProperty({
    description: 'List of addresses to sweep (from estimate response)',
    type: [AddressToSweep],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddressToSweep)
  addresses: AddressToSweep[];

  @ApiProperty({
    description: 'Must be true to execute sweep',
    example: true,
  })
  @IsNotEmpty()
  @IsBoolean()
  confirm: boolean;
}

export class AddressBalanceInfo {
  @ApiProperty({ example: 'TW6nF3VcaNgjWsxCHJ6F1PqHiynSxfP5KK' })
  address: string;

  @ApiProperty({ example: 5 })
  index: number;

  @ApiProperty({ example: '150.50' })
  usdt_balance: string;
}

export class EstimateSweepResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ type: [AddressBalanceInfo] })
  addresses_to_sweep: AddressBalanceInfo[];

  @ApiProperty({ example: '450.75' })
  total_usdt: string;

  @ApiProperty({ example: 'TYourAdminAddressHere' })
  admin_address: string;

  @ApiProperty({ example: 100.50, description: 'Admin wallet current TRX balance' })
  admin_trx_balance: string;

  @ApiProperty({ example: '37.50', description: 'Total TRX required for all sweeps' })
  total_trx_required: string;

  @ApiProperty({ example: 7.5, description: 'TRX cost per address (fixed for non-empty wallets)' })
  trx_per_address: number;

  @ApiProperty({ example: 5, description: 'Number of addresses to sweep' })
  address_count: number;

  @ApiProperty({ example: true, description: 'Whether admin wallet has sufficient TRX balance' })
  sufficient_balance: boolean;
}

export class SweepTransactionResult {
  @ApiProperty({ example: 'TW6nF3VcaNgjWsxCHJ6F1PqHiynSxfP5KK' })
  from_address: string;

  @ApiProperty({ example: 'abc123def456...' })
  tx_hash: string;

  @ApiProperty({ example: 'def456abc123...', nullable: true, description: 'TRX funding transaction hash' })
  delegation_tx_hash: string;

  @ApiProperty({ example: '150.50' })
  usdt_amount: string;

  @ApiProperty({ example: 'pending' })
  status: string;
}

export class FailedAddressInfo {
  @ApiProperty({ example: 'TW6nF3VcaNgjWsxCHJ6F1PqHiynSxfP5KK' })
  address: string;

  @ApiProperty({ example: 'Insufficient energy for delegation' })
  error: string;
}

export class ExecuteSweepResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '450.75' })
  total_swept: string;

  @ApiProperty({ type: [SweepTransactionResult] })
  transactions: SweepTransactionResult[];

  @ApiProperty({ type: [FailedAddressInfo] })
  failed_addresses: FailedAddressInfo[];

  @ApiProperty({ example: 3, description: 'Number of successful sweeps' })
  success_count: number;

  @ApiProperty({ example: 0, description: 'Number of failed sweeps' })
  failed_count: number;
}

export class SweepStatusResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({
    type: 'object',
    properties: {
      tx_hash: { type: 'string', example: 'abc123def456...' },
      status: { type: 'string', example: 'confirmed' },
      from_address: { type: 'string', example: 'TW6nF3VcaNgjWsxCHJ6F1PqHiynSxfP5KK' },
      to_address: { type: 'string', example: 'TAdmin...' },
      usdt_amount: { type: 'string', example: '150.50' },
      funding_tx_hash: { type: 'string', example: 'def456abc123...', description: 'TRX funding transaction' },
      block_number: { type: 'string', example: '58123456' },
      created_at: { type: 'string', example: '2026-03-26T12:00:00Z' },
      error_message: { type: 'string', example: null, nullable: true },
    },
  })
  transaction: any;
}
