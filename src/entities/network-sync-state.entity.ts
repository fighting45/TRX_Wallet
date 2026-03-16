import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('network_sync_state')
export class NetworkSyncState {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  network: string; // Always 'tron' for this service

  @Column({ type: 'bigint', name: 'last_processed_block' })
  lastProcessedBlock: string; // Using string for bigint compatibility

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
