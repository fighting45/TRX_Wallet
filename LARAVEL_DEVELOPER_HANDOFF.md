# Laravel Developer Handoff - TRX Wallet Integration

## 📋 What You're Integrating

A standalone microservice that provides TRON (TRX/TRC20 USDT) wallet functionality:
- Generate deposit addresses for users
- Monitor blockchain for incoming deposits
- Send webhooks to Laravel when deposits detected
- Automatic retry for failed notifications

---

## 📚 Documentation Files (Read in This Order)

### 1. **START HERE** → `LARAVEL_INTEGRATION_README.md`
- Complete integration guide
- Step-by-step setup instructions
- Code examples for all integration points
- Testing and troubleshooting

### 2. **Swagger API Docs** → http://localhost:3002/api/docs
- Interactive API documentation
- Try endpoints directly from browser
- See live request/response examples
- Copy cURL commands

### 3. **Webhook Specification** → `LARAVEL_WEBHOOK_SPEC.md`
- Complete webhook endpoint spec
- Laravel controller template
- Database migrations
- Security implementation (HMAC signatures)

### 4. **Additional References**
- `WALLET_INTEGRATION_GUIDE.md` - Detailed integration guide
- `LaravelCodeTemplates.php` - Copy-paste ready code
- `SETUP_CHECKLIST.md` - Deployment checklist
- `database-setup.sql` - Database schema (in `src/modules/listeners/`)

---

## 🎯 Your Tasks

### Task 1: Initial Setup (30 minutes)
- [ ] Review `LARAVEL_INTEGRATION_README.md`
- [ ] Add environment variables to Laravel `.env`
- [ ] Generate master mnemonic (ONE TIME)
- [ ] Create database migrations
- [ ] Store encrypted mnemonic in database

### Task 2: Webhook Implementation (1-2 hours)
- [ ] Create `WalletWebhookController`
- [ ] Implement HMAC signature verification
- [ ] Add duplicate detection logic
- [ ] Implement balance crediting
- [ ] Add deposit record creation
- [ ] Test webhook with curl

### Task 3: User Address Generation (1 hour)
- [ ] Create `TronWalletService`
- [ ] Implement `getDepositAddress()` method
- [ ] Add address to user profile
- [ ] Display address in user dashboard

### Task 4: Address Monitoring Endpoint (30 minutes)
- [ ] Create `GET /api/wallet-service/addresses` endpoint
- [ ] Add API secret verification
- [ ] Return list of user addresses
- [ ] Test with curl

### Task 5: Testing (1 hour)
- [ ] Test address generation for new user
- [ ] Test address retrieval for existing user
- [ ] Send test webhook and verify balance update
- [ ] Send real small USDT deposit and verify full flow

---

## 🚀 Quick Start Commands

### Generate Mnemonic (Run Once)
```bash
curl -X POST http://localhost:3002/api/wallet/generate-mnemonic
# Save the encrypted_mnemonic to Laravel database
```

### Generate Address for User
```bash
curl -X POST http://localhost:3002/api/wallet/get-address \
  -H "Content-Type: application/json" \
  -d '{
    "encrypted_mnemonic": {...from database...},
    "index": 1,
    "user_id": 1
  }'
```

### Test Webhook (Manual)
```bash
SECRET="your-strong-secret-123"
PAYLOAD='{"user_id":1,"address":"TW6nF...","amount":"100","coin_symbol":"USDT","tx_hash":"test123","block_number":123456}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | cut -d' ' -f2)

curl -X POST http://localhost:8000/api/webhooks/deposit \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIGNATURE" \
  -d "$PAYLOAD"
```

---

## 📡 Endpoints You Need to Know

### Wallet Service Endpoints (Call from Laravel)

| Endpoint | Method | Purpose | When to Call |
|----------|--------|---------|--------------|
| `/api/wallet/generate-mnemonic` | POST | Generate master mnemonic | ONE TIME during setup |
| `/api/wallet/get-address` | POST | Generate user deposit address | When user requests deposit address |
| `/api/wallet/validate-address` | POST | Validate address format | Before processing withdrawals (optional) |

### Laravel Endpoints You Must Create

| Endpoint | Method | Purpose | Called By |
|----------|--------|---------|-----------|
| `/api/webhooks/deposit` | POST | Receive deposit notifications | Wallet Service (every deposit) |
| `/api/wallet-service/addresses` | GET | Provide monitored addresses | Wallet Service (on startup) |

---

## 🔒 Security Requirements

**CRITICAL:** These security measures are non-negotiable:

1. **HMAC Signature Verification**
   - ✅ Always verify `X-Signature` header
   - ✅ Use `hash_hmac('sha256', $request->getContent(), env('WALLET_API_SECRET'))`
   - ❌ Never process webhooks without signature verification

2. **Duplicate Prevention**
   - ✅ Check `tx_hash` uniqueness before processing
   - ✅ Use database constraints (unique index)
   - ❌ Never credit balance without duplicate check

3. **Database Transactions**
   - ✅ Use `DB::transaction()` for balance updates
   - ✅ Ensure atomicity (balance update + deposit record)
   - ❌ Never update balance outside transaction

4. **Secret Management**
   - ✅ Keep `WALLET_API_SECRET` in `.env`
   - ✅ Never commit secrets to git
   - ✅ Use same secret in both Laravel and Node.js

---

## 📊 Database Schema

### Tables You Need to Create

**1. wallet_config** (stores encrypted mnemonic)
```sql
CREATE TABLE wallet_config (
    id BIGINT PRIMARY KEY,
    key VARCHAR(255) UNIQUE,
    value JSON,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

**2. deposits** (stores deposit history)
```sql
CREATE TABLE deposits (
    id BIGINT PRIMARY KEY,
    user_id BIGINT,
    address VARCHAR(255),
    amount DECIMAL(36,18),
    coin_symbol VARCHAR(20),
    tx_hash VARCHAR(255) UNIQUE,  -- Important: UNIQUE constraint
    block_number BIGINT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

**3. users** (add wallet columns)
```sql
ALTER TABLE users
ADD COLUMN tron_address VARCHAR(255) UNIQUE,
ADD COLUMN usdt_balance DECIMAL(20,8) DEFAULT 0,
ADD COLUMN trx_balance DECIMAL(20,8) DEFAULT 0;
```

---

## ✅ Integration Checklist

### Environment Setup
- [ ] `WALLET_SERVICE_URL` in Laravel .env
- [ ] `WALLET_API_SECRET` in Laravel .env
- [ ] `LARAVEL_URL` in Node.js .env
- [ ] `LARAVEL_API_SECRET` in Node.js .env (must match Laravel)
- [ ] Both secrets are identical

### Database
- [ ] `wallet_config` table created
- [ ] `deposits` table created
- [ ] `users` table has wallet columns
- [ ] Master mnemonic stored in `wallet_config`

### Code Implementation
- [ ] Webhook controller created
- [ ] HMAC verification implemented
- [ ] Duplicate detection working
- [ ] Balance crediting implemented
- [ ] Address generation service created
- [ ] Address provider endpoint created

### Testing
- [ ] Can generate mnemonic
- [ ] Can generate user address
- [ ] Address appears in database
- [ ] Test webhook updates balance
- [ ] Real deposit updates balance
- [ ] Duplicate webhooks are ignored

### Production Ready
- [ ] Error logging implemented
- [ ] Transaction logging for audit
- [ ] Production environment variables set
- [ ] Database backups configured
- [ ] Monitoring and alerts set up

---

## 🧪 Test Scenarios

### Scenario 1: New User Deposit Address
```php
// User visits deposit page
$address = TronWalletService::getDepositAddress($userId);
// Expected: New address generated and saved to database
```

### Scenario 2: Existing User Deposit Address
```php
// User revisits deposit page
$address = TronWalletService::getDepositAddress($userId);
// Expected: Same address returned from database
```

### Scenario 3: Deposit Received
```
1. User sends USDT to their address
2. Wait 5-10 minutes for blockchain confirmation
3. Wallet service detects deposit
4. Webhook sent to Laravel
5. Balance credited in database
6. Deposit record created
```

### Scenario 4: Duplicate Webhook
```
1. Webhook received
2. Database check finds existing tx_hash
3. Return success without updating balance
4. Log duplicate attempt
```

---

## 💡 Pro Tips

1. **Start with Swagger Docs**
   - Open http://localhost:3002/api/docs
   - Try each endpoint to understand request/response format
   - Copy the working cURL commands for your tests

2. **Test Webhooks Early**
   - Don't wait for real deposits to test
   - Use the manual webhook test command
   - Verify signature, duplicate detection, and balance updates

3. **Use Logs Extensively**
   - Log every deposit processing step
   - Include tx_hash in all logs for traceability
   - Monitor logs during real deposit testing

4. **Database First**
   - Check database state before processing
   - Use transactions for consistency
   - Verify constraints prevent duplicates

5. **Monitor Auto-Start**
   - Ensure `AUTO_START_LISTENERS=true` in production
   - Verify address provider endpoint works
   - Test service restart scenario

---

## 🆘 Need Help?

**Check These First:**
1. Swagger Docs: http://localhost:3002/api/docs
2. `LARAVEL_INTEGRATION_README.md` - Troubleshooting section
3. `LARAVEL_WEBHOOK_SPEC.md` - Complete webhook implementation
4. Service logs: `/tmp/trx-wallet-swagger.log`

**Common Issues:**
- "Invalid signature" → Check secrets match in both .env files
- "Duplicate tx_hash" → Expected behavior, means duplicate prevention works
- "Webhook not received" → Check Laravel endpoint accessibility and logs

---

## 🎉 Success Criteria

Integration is complete when:
- ✅ Can generate deposit addresses for users
- ✅ Addresses are monitored automatically
- ✅ Real deposits credit user balances
- ✅ No duplicate deposits are processed
- ✅ Failed webhooks retry automatically
- ✅ Service survives restart without losing monitoring state

---

**Estimated Total Time:** 4-6 hours for complete integration

**Good luck with the integration! 🚀**
