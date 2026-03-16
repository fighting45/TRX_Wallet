-- Run this SQL script on your production PostgreSQL database
-- Database: tron_wallet

-- Table 1: Track processed deposits (prevents duplicates)
CREATE TABLE IF NOT EXISTS processed_deposits (
    id SERIAL PRIMARY KEY,
    "txHash" VARCHAR(255) UNIQUE NOT NULL,
    "userId" INTEGER NOT NULL,
    address VARCHAR(255) NOT NULL,
    amount DECIMAL(36, 18) NOT NULL,
    "coinSymbol" VARCHAR(20) NOT NULL,
    "contractAddress" VARCHAR(255),
    "processedAt" TIMESTAMP DEFAULT NOW(),
    "createdAt" TIMESTAMP DEFAULT NOW(),
    "updatedAt" TIMESTAMP DEFAULT NOW()
);

-- Table 2: Track blockchain sync state (for catch-up after downtime)
CREATE TABLE IF NOT EXISTS network_sync_state (
    id SERIAL PRIMARY KEY,
    network VARCHAR(20) UNIQUE NOT NULL,
    "lastProcessedBlock" BIGINT NOT NULL,
    "createdAt" TIMESTAMP DEFAULT NOW(),
    "updatedAt" TIMESTAMP DEFAULT NOW()
);

-- Table 3: Webhook retry queue (for failed Laravel notifications)
CREATE TABLE IF NOT EXISTS webhook_queue (
    id SERIAL PRIMARY KEY,
    "depositData" JSONB NOT NULL,
    "retryCount" INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    "nextRetryAt" TIMESTAMP NOT NULL,
    "createdAt" TIMESTAMP DEFAULT NOW(),
    "updatedAt" TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_processed_deposits_txhash ON processed_deposits("txHash");
CREATE INDEX IF NOT EXISTS idx_processed_deposits_userid ON processed_deposits("userId");
CREATE INDEX IF NOT EXISTS idx_processed_deposits_address ON processed_deposits(address);
CREATE INDEX IF NOT EXISTS idx_webhook_queue_status ON webhook_queue(status);
CREATE INDEX IF NOT EXISTS idx_webhook_queue_next_retry ON webhook_queue("nextRetryAt");

-- Insert initial sync state for TRON network
INSERT INTO network_sync_state (network, "lastProcessedBlock")
VALUES ('tron', 0)
ON CONFLICT (network) DO NOTHING;
