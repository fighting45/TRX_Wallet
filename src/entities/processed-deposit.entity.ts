import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('processed_deposits')
@Index(['txHash'], { unique: true })
@Index(['blockNumber'])
export class ProcessedDeposit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, name: 'tx_hash' })
  txHash: string;

  @Column({ type: 'bigint', name: 'block_number', nullable: true })
  blockNumber: string; // Using string for bigint compatibility

  @Column({ type: 'int', name: 'user_id' })
  userId: number;

  @Column({ type: 'varchar', length: 255 })
  address: string;

  @Column({ type: 'decimal', precision: 36, scale: 18 })
  amount: string;

  @Column({ type: 'varchar', length: 20, name: 'coin_symbol' })
  coinSymbol: string; // TRX or token symbol (USDT, USDC, etc.)

  @Column({ type: 'varchar', length: 255, name: 'contract_address', nullable: true })
  contractAddress: string; // TRC20 token contract address

  @CreateDateColumn({ name: 'processed_at' })
  processedAt: Date;
}
