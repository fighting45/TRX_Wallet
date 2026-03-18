# TRX Wallet Service

Standalone TRON/TRC20 wallet microservice for cryptocurrency exchanges. Provides secure address generation and automated deposit monitoring.

## Features

- **BIP39/BIP44 HD Wallet** - Generate unlimited addresses from single mnemonic
- **TRC20 Token Support** - Monitor USDT, USDC, and all TRC20 tokens
- **Auto-Start Listeners** - Fetches addresses from Laravel on boot
- **GetBlock Integration** - Unlimited RPC requests (no rate limits)
- **Webhook Retry Queue** - Never miss deposits even if Laravel is down
- **Database Persistence** - Prevents duplicate deposit processing
- **Compatible Mnemonics** - Works with TronLink, Trust Wallet, Ledger

## Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│   Laravel   │◄────────┤  TRX Wallet      │────────►│   GetBlock  │
│  (Main App) │ Webhook │  Microservice    │   RPC   │  TRON API   │
└─────────────┘         └──────────────────┘         └─────────────┘
      │                         │
      │                         │
      │                  ┌──────▼──────┐
      │                  │  PostgreSQL │
      └──────────────────┤  (Deposits) │
                         └─────────────┘
```

## Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Database Setup

Create PostgreSQL database:

```sql
CREATE DATABASE tron_wallet;
```

Tables will be auto-created on first run (development mode).

### 3. Environment Configuration

Create `.env` file:

```env
# Server
NODE_ENV=development
PORT=3001

# Laravel Integration
LARAVEL_URL=http://localhost:8000
LARAVEL_API_SECRET=your-secret-key-here

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=password
DB_DATABASE=tron_wallet
DB_LOGGING=false

# Security
MASTER_PASSWORD=your-master-password-here

# TRON Network
TRON_RPC_URL=https://go.getblock.us/7226f90e75824bc984c6c65aa00b7511/jsonrpc
TRON_API_TYPE=jsonrpc

# Auto-Start
AUTO_START_LISTENERS=true
```

### 4. Start Service

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

## API Endpoints

### Generate Mnemonic

```http
POST /api/wallet/generate-mnemonic
Content-Type: application/json

{
  "word_count": 12
}
```

**Response:**

```json
{
  "success": true,
  "encrypted_mnemonic": {
    "encrypted": "...",
    "iv": "...",
    "salt": "...",
    "authTag": "..."
  },
  "message": "Mnemonic generated and encrypted"
}
```

### Get Address for User

Generates TRON address and automatically starts monitoring for deposits.

```http
POST /api/wallet/get-address
Content-Type: application/json

{
  "encrypted_mnemonic": {
    "encrypted": "...",
    "iv": "...",
    "salt": "...",
    "authTag": "..."
  },
  "index": 0,
  "user_id": 123
}
```

**Response:**

```json
{
  "success": true,
  "address": "TXYZnHYqm7xqQtXvLqCgvX5VQQ5XzQV3ys",
  "index": 0,
  "derivation_path": "m/44'/195'/0'/0/0",
  "monitoring": true
}
```

### Validate Mnemonic

```http
POST /api/wallet/validate-mnemonic
Content-Type: application/json

{
  "mnemonic": "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
}
```

### Validate Address

```http
POST /api/wallet/validate-address
Content-Type: application/json

{
  "address": "TXYZnHYqm7xqQtXvLqCgvX5VQQ5XzQV3ys"
}
```

### Health Check

```http
GET /api/wallet/health
```

## Laravel Integration

### 1. Laravel Endpoint (Required)

TRX Wallet Service fetches addresses on startup from:

```
GET {LARAVEL_URL}/api/wallet-service/addresses?network=tron
Header: X-API-Secret: {LARAVEL_API_SECRET}
```

**Expected Response:**

```json
{
  "addresses": [
    {
      "user_id": 1,
      "network": "tron",
      "address": "TXYZnHYqm7xqQtXvLqCgvX5VQQ5XzQV3ys"
    },
    {
      "user_id": 2,
      "network": "tron",
      "address": "TABCdefg123456789ABCDEFG123456789"
    }
  ]
}
```

### 2. Laravel Webhook (Required)

Receive deposit notifications:

```php
Route::post('/api/v1/deposits/webhook', function (Request $request) {
    // Verify signature
    $signature = hash_hmac('sha256', $request->getContent(), env('WALLET_API_SECRET'));
    if ($signature !== $request->header('X-Signature')) {
        abort(403, 'Invalid signature');
    }

    $deposit = $request->all();

    // Update user balance
    User::find($deposit['user_id'])->increment('balance', $deposit['amount']);

    // Log deposit
    Deposit::create([
        'user_id' => $deposit['user_id'],
        'network' => $deposit['network'],
        'coin_symbol' => $deposit['coin_symbol'],
        'amount' => $deposit['amount'],
        'tx_hash' => $deposit['tx_hash'],
        'confirmations' => $deposit['confirmations'],
        'block_number' => $deposit['block_number'],
        'token_contract' => $deposit['token_contract'] ?? null,
    ]);

    return response()->json(['success' => true]);
});
```

### 3. Laravel Call Node.js to Generate Address

```php
use Illuminate\Support\Facades\Http;

$response = Http::post('http://localhost:3001/api/wallet/get-address', [
    'encrypted_mnemonic' => $user->encrypted_mnemonic,
    'index' => $user->address_index,
    'user_id' => $user->id,
]);

$addressData = $response->json();
$user->tron_address = $addressData['address'];
$user->save();
```

## Webhook Payload

When a deposit is detected, the service sends this payload to Laravel:

```json
{
  "user_id": 123,
  "network": "tron",
  "coin_symbol": "USDT",
  "amount": 100.5,
  "from_address": "TFromAddress123...",
  "to_address": "TToAddress456...",
  "tx_hash": "abc123def456...",
  "confirmations": 19,
  "block_number": 81043838,
  "timestamp": 1735689600,
  "token_contract": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
}
```

## Database Schema

### processed_deposits

Prevents duplicate processing of transactions.

| Column           | Type         | Description                   |
| ---------------- | ------------ | ----------------------------- |
| id               | SERIAL       | Primary key                   |
| tx_hash          | VARCHAR(255) | Transaction hash (unique)     |
| block_number     | BIGINT       | Block number                  |
| user_id          | INT          | User ID from Laravel          |
| address          | VARCHAR(255) | Deposit address               |
| amount           | DECIMAL      | Deposit amount                |
| coin_symbol      | VARCHAR(20)  | TRX or token symbol           |
| contract_address | VARCHAR(255) | TRC20 contract (nullable)     |
| processed_at     | TIMESTAMP    | When deposit was processed    |

### network_sync_state

Tracks last processed block for catch-up after downtime.

| Column               | Type        | Description               |
| -------------------- | ----------- | ------------------------- |
| network              | VARCHAR(20) | Always 'tron'             |
| last_processed_block | BIGINT      | Last processed block      |
| updated_at           | TIMESTAMP   | Last update time          |

### webhook_queue

Retry queue for failed Laravel webhooks.

| Column        | Type      | Description                     |
| ------------- | --------- | ------------------------------- |
| id            | SERIAL    | Primary key                     |
| deposit_data  | JSONB     | Full deposit data               |
| retry_count   | INT       | Number of retry attempts        |
| last_error    | TEXT      | Last error message              |
| next_retry_at | TIMESTAMP | When to retry                   |
| status        | VARCHAR   | pending/processing/completed... |
| created_at    | TIMESTAMP | Created time                    |
| updated_at    | TIMESTAMP | Updated time                    |

## How It Works

### 1. **Startup**

- Service connects to database
- Fetches all TRON addresses from Laravel
- Starts monitoring blockchain

### 2. **Address Generation**

- Laravel calls `/api/wallet/get-address` with user_id
- Service derives address from mnemonic using BIP44
- Service auto-registers address for monitoring
- Returns address to Laravel

### 3. **Deposit Detection**

- Service polls TRON blockchain every 5 minutes
- Checks last 20 transactions for each monitored address
- Detects both TRX and TRC20 token transfers
- Parses transaction data (amount, token, etc.)

### 4. **Webhook Notification**

- Creates HMAC signature for security
- Sends deposit data to Laravel webhook
- If Laravel is down, saves to retry queue
- Marks transaction as processed in database

### 5. **Retry Queue**

- Background job processes failed webhooks
- Exponential backoff retry strategy
- Ensures no deposits are lost

## Supported Tokens

The service automatically detects and processes:

- **TRX** - Native TRON token
- **USDT** (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t)
- **USDC** (TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8)
- **Any TRC20 token** - Symbol and decimals auto-fetched

## Mnemonic Compatibility

Mnemonics generated by this service are **BIP39 compliant** and work with:

- ✅ **TronLink** (TRON native wallet)
- ✅ **Trust Wallet** (multi-chain)
- ✅ **Ledger** (hardware wallet)
- ❌ **Metamask** (Ethereum-only, different chain)
- ❌ **Phantom** (Solana-only, different chain)

## Security Best Practices

1. **NEVER expose MASTER_PASSWORD** - This encrypts all mnemonics
2. **Rotate LARAVEL_API_SECRET regularly**
3. **Use HTTPS in production** - Protect webhook data
4. **Store encrypted_mnemonic securely** in Laravel database
5. **Backup database regularly** - Contains deposit history
6. **Monitor webhook queue** - Alert if retry queue grows

## Monitoring & Alerts

### Health Check

```bash
curl http://localhost:3001/api/wallet/health
```

### Database Queries

```sql
-- Check recent deposits
SELECT * FROM processed_deposits ORDER BY processed_at DESC LIMIT 10;

-- Check pending webhooks
SELECT * FROM webhook_queue WHERE status = 'pending';

-- Check sync state
SELECT * FROM network_sync_state;
```

## Troubleshooting

### Service won't start

```bash
# Check database connection
psql -h localhost -U postgres -d tron_wallet

# Check environment variables
cat .env

# Check logs
npm run start:dev
```

### No deposits detected

1. Verify TRON_RPC_URL is correct
2. Check GetBlock API status
3. Verify addresses are registered: `SELECT * FROM processed_deposits;`
4. Check TRON blockchain explorer manually

### Webhooks failing

1. Verify LARAVEL_URL is accessible
2. Check LARAVEL_API_SECRET matches
3. View retry queue: `SELECT * FROM webhook_queue WHERE status = 'failed';`

## GetBlock Configuration

This service uses GetBlock.io for unlimited TRON RPC requests.

**Token:** `7226f90e75824bc984c6c65aa00b7511`

**Endpoint:** `https://go.getblock.us/7226f90e75824bc984c6c65aa00b7511/jsonrpc`

**Alternative (REST):** `https://go.getblock.us/7226f90e75824bc984c6c65aa00b7511`

To switch between JSON-RPC and REST:

```env
# Use JSON-RPC (recommended)
TRON_API_TYPE=jsonrpc

# Use REST API (fallback)
TRON_API_TYPE=rest
```

## Development

### Project Structure

```
src/
├── entities/               # TypeORM database entities
│   ├── processed-deposit.entity.ts
│   ├── network-sync-state.entity.ts
│   └── webhook-queue.entity.ts
├── modules/
│   ├── wallet/            # Address generation
│   │   ├── wallet.controller.ts
│   │   ├── wallet.service.ts
│   │   └── wallet.module.ts
│   ├── listener/          # Deposit monitoring
│   │   ├── listener.service.ts
│   │   ├── bootstrap.service.ts
│   │   └── listener.module.ts
│   └── encryption/        # Mnemonic encryption
│       ├── encryption.service.ts
│       └── encryption.module.ts
├── app.module.ts          # Main application module
└── main.ts                # Entry point
```

### Run Tests

```bash
npm test
```

### Build for Production

```bash
npm run build
```

## Production Deployment

### 1. Environment

```env
NODE_ENV=production
PORT=3001
```

### 2. Process Manager

Use PM2 for automatic restart:

```bash
npm install -g pm2
pm2 start dist/main.js --name trx-wallet
pm2 save
pm2 startup
```

### 3. Reverse Proxy

Nginx configuration:

```nginx
server {
    listen 80;
    server_name wallet.example.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## License

Private - Exbotix Team

## Support

For issues or questions, contact the development team.
