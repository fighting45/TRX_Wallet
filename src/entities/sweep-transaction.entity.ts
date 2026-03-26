import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('sweep_transactions')
@Index(['txHash'], { unique: true })
@Index(['fromAddress'])
@Index(['status'])
@Index(['createdAt'])
export class SweepTransaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, unique: true })
  txHash: string;

  @Column({ type: 'varchar', length: 42 })
  fromAddress: string;

  @Column({ type: 'varchar', length: 42 })
  toAddress: string; // Admin address

  @Column({ type: 'decimal', precision: 36, scale: 6 })
  usdtAmount: string;

  @Column({ type: 'int' })
  derivationIndex: number;

  @Column({ type: 'enum', enum: ['pending', 'confirmed', 'failed'] })
  status: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  delegationTxHash: string; // Energy delegation transaction hash

  @Column({ type: 'int', default: 0 })
  energyUsed: number;

  @Column({ type: 'bigint', nullable: true })
  blockNumber: string;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @Column({ type: 'int', default: 0 })
  retryCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
