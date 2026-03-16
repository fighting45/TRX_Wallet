# TRX Wallet Service - Laravel Integration Guide

## Quick Start for Laravel Developers

This microservice provides TRON (TRX/TRC20 USDT) wallet functionality for your Laravel application.

---

## 📚 Documentation Resources

### 1. Interactive API Documentation (Swagger)
**URL:** http://localhost:3002/api/docs

- Live API testing interface
- Detailed request/response examples
- Try endpoints directly from browser
- Copy cURL commands for testing

### 2. Webhook Implementation Spec
**File:** `LARAVEL_WEBHOOK_SPEC.md`

Complete specification for the webhook endpoint Laravel must implement, including:
- Request/response format
- HMAC signature verification
- Laravel controller example
- Database migration
- Error handling

### 3. Additional Documentation Files
- `WALLET_INTEGRATION_GUIDE.md` - Overall integration guide
- `LaravelCodeTemplates.php` - Ready-to-use Laravel code
- `SETUP_CHECKLIST.md` - Deployment checklist

---

## 🚀 Integration Steps

### Step 1: Environment Setup

Add to Laravel `.env`:
```env
# Wallet Service Integration
WALLET_SERVICE_URL=http://localhost:3002
WALLET_API_SECRET=your-strong-secret-123  # Must match LARAVEL_API_SECRET in Node.js
```

Add to Node.js `.env`:
```env
LARAVEL_URL=http://localhost:8000
LARAVEL_API_SECRET=your-strong-secret-123  # Must match WALLET_API_SECRET in Laravel
AUTO_START_LISTENERS=true
```

**IMPORTANT:** Both secrets must match for webhook security!

---

### Step 2: Generate Master Mnemonic (ONE TIME ONLY)

```bash
# Call this endpoint ONCE during initial setup
curl -X POST http://localhost:3002/api/wallet/generate-mnemonic

# Response:
{
  "success": true,
  "encrypted_mnemonic": {
    "encrypted": "f9396b05abeb1037...",
    "iv": "b88c7c185a2012...",
    "salt": "2bfd374a44fa76...",
    "authTag": "372341bb8cd9b0..."
  },
  "message": "Mnemonic generated and encrypted. Store this securely in Laravel database."
}
```

**Store this entire `encrypted_mnemonic` object in your Laravel database** (see migration below).

---

### Step 3: Database Setup

#### Laravel Migrations

**1. Master Mnemonic Storage:**
```php
php artisan make:migration create_wallet_config_table

// Migration file:
Schema::create('wallet_config', function (Blueprint $table) {
    $table->id();
    $table->string('key')->unique();
    $table->json('value');
    $table->timestamps();
});

// Store mnemonic:
DB::table('wallet_config')->insert([
    'key' => 'master_mnemonic',
    'value' => json_encode($encryptedMnemonic), // From Step 2
]);
```

**2. Deposits Table:**
```php
php artisan make:migration create_deposits_table

// See LARAVEL_WEBHOOK_SPEC.md for complete migration
```

**3. Users Table - Add Wallet Columns:**
```php
php artisan make:migration add_wallet_columns_to_users

Schema::table('users', function (Blueprint $table) {
    $table->string('tron_address')->nullable()->unique();
    $table->decimal('usdt_balance', 20, 8)->default(0);
    $table->decimal('trx_balance', 20, 8)->default(0);
});
```

---

### Step 4: Implement Webhook Receiver

Create Laravel route and controller to receive deposit notifications.

**See `LARAVEL_WEBHOOK_SPEC.md` for complete implementation.**

**Quick Reference:**
```php
// routes/api.php
Route::post('/webhooks/deposit', [WalletWebhookController::class, 'handleDeposit']);

// Controller must:
// 1. Verify HMAC signature
// 2. Check for duplicates
// 3. Credit user balance
// 4. Save deposit record
```

---

### Step 5: Generate User Addresses

When user requests deposit address:

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\DB;

class TronWalletService
{
    public function getDepositAddress(int $userId): string
    {
        // Check if user already has address
        $user = User::find($userId);
        if ($user->tron_address) {
            return $user->tron_address;
        }

        // Get encrypted mnemonic from database
        $config = DB::table('wallet_config')
            ->where('key', 'master_mnemonic')
            ->first();

        $encryptedMnemonic = json_decode($config->value, true);

        // Call wallet service to generate address
        $response = Http::post(env('WALLET_SERVICE_URL') . '/api/wallet/get-address', [
            'encrypted_mnemonic' => $encryptedMnemonic,
            'index' => $userId,  // Use user ID as index
            'user_id' => $userId, // Auto-register for monitoring
        ]);

        if (!$response->successful()) {
            throw new \Exception('Failed to generate address');
        }

        $data = $response->json();
        $address = $data['address'];

        // Save to user record
        $user->tron_address = $address;
        $user->save();

        return $address;
    }
}
```

---

### Step 6: Provide Address List Endpoint (Optional but Recommended)

Create endpoint for wallet service to fetch all addresses on startup:

```php
// routes/api.php
Route::get('/wallet-service/addresses', function (Request $request) {
    // Verify API secret
    if ($request->header('X-API-Secret') !== env('WALLET_API_SECRET')) {
        return response()->json(['error' => 'Unauthorized'], 403);
    }

    // Return all user addresses
    $addresses = User::whereNotNull('tron_address')
        ->get(['id as user_id', 'tron_address as address'])
        ->map(fn($u) => [
            'user_id' => $u->user_id,
            'address' => $u->address,
            'network' => 'tron'
        ]);

    return response()->json(['addresses' => $addresses]);
});
```

**Why is this needed?**
When wallet service restarts, it loses in-memory address registry. This endpoint allows it to reload all monitored addresses automatically.

---

## 📡 API Endpoints Reference

### For Laravel Backend Use:

| Endpoint | Method | Purpose | Docs |
|----------|--------|---------|------|
| `/api/wallet/generate-mnemonic` | POST | Generate master mnemonic (ONE TIME) | [Swagger](http://localhost:3002/api/docs) |
| `/api/wallet/get-address` | POST | Generate user deposit address | [Swagger](http://localhost:3002/api/docs) |
| `/api/wallet/validate-address` | POST | Validate TRON address format | [Swagger](http://localhost:3002/api/docs) |

### Laravel Must Implement:

| Endpoint | Method | Purpose | Docs |
|----------|--------|---------|------|
| `/api/webhooks/deposit` | POST | Receive deposit notifications | `LARAVEL_WEBHOOK_SPEC.md` |
| `/api/wallet-service/addresses` | GET | Provide address list for monitoring | See Step 6 above |

---

## 🔒 Security Checklist

- ✅ **HMAC Signature Verification:** Always verify `X-Signature` header in webhooks
- ✅ **Duplicate Prevention:** Check `tx_hash` uniqueness before processing deposits
- ✅ **Secret Management:** Keep `WALLET_API_SECRET` secure, never commit to git
- ✅ **Database Transactions:** Use transactions for balance updates
- ✅ **Input Validation:** Validate all webhook payloads
- ✅ **Logging:** Log all deposit activities for audit trail

---

## 🧪 Testing

### 1. Test Address Generation

```bash
curl -X POST http://localhost:3002/api/wallet/get-address \
  -H "Content-Type: application/json" \
  -d '{
    "encrypted_mnemonic": {...from database...},
    "index": 999,
    "user_id": 999
  }'

# Response:
{
  "success": true,
  "address": "TW6nF3VcaNgjWsxCHJ6F1PqHiynSxfP5KK",
  "monitoring": true
}
```

### 2. Test Webhook (Manual)

```bash
# Generate signature
SECRET="your-strong-secret-123"
PAYLOAD='{"user_id":1,"address":"TW6nF...","amount":"100","coin_symbol":"USDT","tx_hash":"test123","block_number":123456}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | cut -d' ' -f2)

# Send webhook
curl -X POST http://localhost:8000/api/webhooks/deposit \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIGNATURE" \
  -d "$PAYLOAD"
```

### 3. Test Real Deposit

1. Generate address for test user
2. Send small USDT to that address
3. Wait 5-10 minutes for listener to detect
4. Check Laravel logs for webhook delivery
5. Verify user balance updated

---

## 📊 Monitoring

### Check Listener Status
```bash
# View service logs
tail -f /tmp/trx-wallet-swagger.log

# Check if address is being monitored
# You'll see: "➕ Registering new address for monitoring: TW6nF..."
```

### Check Database
```sql
-- View processed deposits (Node.js database)
SELECT * FROM processed_deposits ORDER BY "processedAt" DESC;

-- Check for failed webhooks
SELECT * FROM webhook_queue WHERE status = 'pending';

-- View deposits (Laravel database)
SELECT * FROM deposits ORDER BY created_at DESC;
```

---

## 🐛 Troubleshooting

### Webhook Not Received

1. **Check Node.js logs:**
   ```bash
   tail -100 /tmp/trx-wallet-swagger.log | grep -i "error\|webhook"
   ```

2. **Verify Laravel endpoint is accessible:**
   ```bash
   curl http://localhost:8000/api/webhooks/deposit
   ```

3. **Check webhook queue for retries:**
   ```sql
   SELECT * FROM webhook_queue;
   ```

### Address Not Monitoring

1. **Ensure `user_id` was passed** when calling `/wallet/get-address`
2. **Check service logs** for registration message
3. **Restart service** with `AUTO_START_LISTENERS=true` to reload addresses

### Invalid Signature Error

1. **Verify secrets match:**
   - Laravel: `WALLET_API_SECRET`
   - Node.js: `LARAVEL_API_SECRET`
2. **Check signature generation** matches verification
3. **Inspect raw request body** used for HMAC

---

## 💬 Support

**Documentation:**
- Interactive API Docs: http://localhost:3002/api/docs
- Webhook Spec: `LARAVEL_WEBHOOK_SPEC.md`
- Integration Guide: `WALLET_INTEGRATION_GUIDE.md`

**Logs:**
- Service logs: `/tmp/trx-wallet-swagger.log`
- Database: PostgreSQL `tron_wallet`

**Common Questions:**
- Q: How often does it check for deposits?
  A: Every 5 minutes

- Q: Can I use different mnemonic for each user?
  A: No, use ONE master mnemonic and derive addresses using different indices

- Q: What if webhook fails?
  A: Auto-retry with exponential backoff (5min, 30min, 2hr, 24hr)

---

## 🎯 Next Steps After Integration

1. **Test deposit flow** with real small USDT transaction
2. **Implement withdrawal** (future feature)
3. **Add balance display** in Laravel user dashboard
4. **Set up monitoring** and alerts for webhook failures
5. **Production deployment** with environment-specific configs

---

## ⚠️ Important Notes

- **Master mnemonic is generated ONCE** - never regenerate or you'll lose access to funds
- **Always use same index** for same user - addresses are deterministic
- **Webhook signature verification** is critical for security
- **Database transactions** prevent race conditions in balance updates
- **Auto-start listeners** ensures monitoring continues after service restarts

---

**Ready to integrate? Start with the Swagger docs:** http://localhost:3002/api/docs
