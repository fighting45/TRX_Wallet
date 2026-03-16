import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('webhook_queue')
@Index(['nextRetryAt'])
export class WebhookQueue {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'jsonb', name: 'deposit_data' })
  depositData: any; // Stores the full deposit data to retry

  @Column({ type: 'int', name: 'retry_count', default: 0 })
  retryCount: number;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError: string;

  @Column({ type: 'timestamp', name: 'next_retry_at' })
  nextRetryAt: Date;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: string; // 'pending', 'processing', 'completed', 'failed'

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
