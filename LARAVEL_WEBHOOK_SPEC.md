# Laravel Webhook Endpoint Specification

## Endpoint Laravel Must Implement

```
POST /api/webhooks/deposit
```

This endpoint will receive deposit notifications from the TRX Wallet Service.

---

## Request Headers

```
Content-Type: application/json
X-Signature: <HMAC-SHA256 signature>
```

### HMAC Signature Verification

The `X-Signature` header contains HMAC-SHA256 signature of the request body.

**Laravel Verification Code:**
```php
$signature = hash_hmac('sha256', $request->getContent(), env('WALLET_API_SECRET'));

if ($signature !== $request->header('X-Signature')) {
    return response()->json(['error' => 'Invalid signature'], 403);
}
```

**IMPORTANT:** `WALLET_API_SECRET` in Laravel must match `LARAVEL_API_SECRET` in Node.js .env

---

## Request Body

```json
{
  "user_id": 1,
  "address": "TW6nF3VcaNgjWsxCHJ6F1PqHiynSxfP5KK",
  "amount": "100.50",
  "coin_symbol": "USDT",
  "contract_address": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  "tx_hash": "abc123def456...",
  "block_number": 58123456,
  "block_timestamp": 1710614400,
  "confirmations": 19
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `user_id` | integer | Your Laravel user ID |
| `address` | string | User's deposit address |
| `amount` | string | Deposit amount (decimal string) |
| `coin_symbol` | string | "TRX" or "USDT" |
| `contract_address` | string \| null | TRC20 contract (null for native TRX) |
| `tx_hash` | string | Transaction hash (unique identifier) |
| `block_number` | integer | Block number |
| `block_timestamp` | integer | Unix timestamp |
| `confirmations` | integer | Number of confirmations (min: 19) |

---

## Response

### Success (200 OK)
```json
{
  "success": true
}
```

### Error (4xx/5xx)
Any non-200 response will trigger retry mechanism.

**Retry Schedule:**
- Attempt 1: Immediately
- Attempt 2: 5 minutes later
- Attempt 3: 30 minutes later
- Attempt 4: 2 hours later
- Attempt 5: 24 hours later

---

## Laravel Implementation Example

### Route
```php
// routes/api.php
Route::post('/webhooks/deposit', [WalletWebhookController::class, 'handleDeposit']);
```

### Controller
```php
<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Models\Deposit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class WalletWebhookController extends Controller
{
    public function handleDeposit(Request $request)
    {
        // 1. Verify HMAC signature
        $signature = hash_hmac('sha256', $request->getContent(), env('WALLET_API_SECRET'));

        if ($signature !== $request->header('X-Signature')) {
            Log::warning('Invalid webhook signature', ['ip' => $request->ip()]);
            return response()->json(['error' => 'Invalid signature'], 403);
        }

        // 2. Validate request data
        $validated = $request->validate([
            'user_id' => 'required|integer|exists:users,id',
            'address' => 'required|string',
            'amount' => 'required|numeric|min:0',
            'coin_symbol' => 'required|string|in:TRX,USDT',
            'tx_hash' => 'required|string',
            'block_number' => 'required|integer',
        ]);

        // 3. Check for duplicate (idempotency)
        if (Deposit::where('tx_hash', $validated['tx_hash'])->exists()) {
            Log::info('Duplicate deposit webhook ignored', ['tx_hash' => $validated['tx_hash']]);
            return response()->json(['success' => true]);
        }

        try {
            // 4. Process deposit in database transaction
            DB::transaction(function () use ($validated, $request) {
                // Credit user balance
                $user = User::findOrFail($validated['user_id']);

                if ($validated['coin_symbol'] === 'USDT') {
                    $user->increment('usdt_balance', $validated['amount']);
                } else {
                    $user->increment('trx_balance', $validated['amount']);
                }

                // Save deposit record
                Deposit::create([
                    'user_id' => $validated['user_id'],
                    'address' => $validated['address'],
                    'amount' => $validated['amount'],
                    'coin_symbol' => $validated['coin_symbol'],
                    'contract_address' => $request->contract_address,
                    'tx_hash' => $validated['tx_hash'],
                    'block_number' => $validated['block_number'],
                    'block_timestamp' => $validated['block_timestamp'],
                    'confirmations' => $request->confirmations,
                    'status' => 'completed',
                ]);

                Log::info('Deposit processed successfully', [
                    'user_id' => $validated['user_id'],
                    'amount' => $validated['amount'],
                    'coin' => $validated['coin_symbol'],
                    'tx_hash' => $validated['tx_hash'],
                ]);
            });

            return response()->json(['success' => true]);

        } catch (\Exception $e) {
            Log::error('Deposit processing failed', [
                'error' => $e->getMessage(),
                'tx_hash' => $validated['tx_hash'],
            ]);

            // Return 500 to trigger retry
            return response()->json(['error' => 'Processing failed'], 500);
        }
    }
}
```

### Migration
```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::create('deposits', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->string('address');
            $table->decimal('amount', 36, 18);
            $table->string('coin_symbol', 20);
            $table->string('contract_address')->nullable();
            $table->string('tx_hash')->unique();
            $table->bigInteger('block_number');
            $table->integer('block_timestamp');
            $table->integer('confirmations');
            $table->string('status', 20)->default('completed');
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->index('user_id');
            $table->index('tx_hash');
        });
    }

    public function down()
    {
        Schema::dropIfExists('deposits');
    }
};
```

### Model
```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Deposit extends Model
{
    protected $fillable = [
        'user_id',
        'address',
        'amount',
        'coin_symbol',
        'contract_address',
        'tx_hash',
        'block_number',
        'block_timestamp',
        'confirmations',
        'status',
    ];

    protected $casts = [
        'amount' => 'decimal:8',
        'block_number' => 'integer',
        'block_timestamp' => 'integer',
        'confirmations' => 'integer',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
```

---

## Environment Variables

Add to Laravel `.env`:

```env
# Wallet Service Integration
WALLET_API_SECRET=your-strong-secret-123  # Must match LARAVEL_API_SECRET in Node.js
WALLET_SERVICE_URL=http://localhost:3002  # TRX Wallet Service URL
```

---

## Testing the Webhook

### Test with cURL
```bash
# Generate test signature
SECRET="your-strong-secret-123"
PAYLOAD='{"user_id":1,"address":"TW6nF...","amount":"100","coin_symbol":"USDT","tx_hash":"test123","block_number":123456}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | cut -d' ' -f2)

# Send test webhook
curl -X POST http://localhost:8000/api/webhooks/deposit \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIGNATURE" \
  -d "$PAYLOAD"
```

---

## Security Checklist

- ✅ Verify HMAC signature on every request
- ✅ Check for duplicate tx_hash before processing
- ✅ Use database transactions for balance updates
- ✅ Log all deposit activities
- ✅ Validate all input fields
- ✅ Return 200 only after successful processing
- ✅ Never expose WALLET_API_SECRET in logs or responses

---

## Common Issues

### Issue: "Invalid signature"
**Solution:** Ensure `WALLET_API_SECRET` matches on both services

### Issue: Duplicate deposits
**Solution:** Always check `tx_hash` uniqueness before processing

### Issue: Webhook not received
**Solution:**
1. Check Node.js logs for errors
2. Verify `LARAVEL_URL` in Node.js .env
3. Check Laravel route is accessible
4. Review webhook_queue table for failed attempts

---

## Support

For webhook integration issues:
1. Check Node.js logs: `/tmp/trx-wallet-restart.log`
2. Check webhook retry queue: `SELECT * FROM webhook_queue;`
3. Verify signature generation matches Laravel verification
