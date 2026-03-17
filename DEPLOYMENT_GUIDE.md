# TRX Wallet Service - Deployment Guide for DevOps

## 📦 Project Overview

**Service:** TRX Wallet Service (TRON/TRC20 deposit monitoring)
**Tech Stack:** Node.js (NestJS), PostgreSQL, TypeScript
**Purpose:** Generate TRON addresses and monitor deposits for Laravel application

---

## 🏗️ Build Process

### Development Build
```bash
cd /path/to/TRX_Wallet
npm install
npm run start:dev  # Hot reload for development
```

### Production Build
```bash
cd /path/to/TRX_Wallet
npm install --production
npm run build

# Build output: dist/ folder
# Start production: npm run start:prod
```

---

## 📋 Server Requirements

### Minimum Requirements
- **Node.js:** v18.x or higher
- **RAM:** 512MB minimum, 1GB recommended
- **CPU:** 1 core minimum
- **Storage:** 10GB (for database and logs)
- **PostgreSQL:** 12.x or higher
- **Network:** Outbound HTTPS access to:
  - `api.trongrid.io` (TRON blockchain API)
  - Laravel application URL

### Recommended Production Setup
- **RAM:** 2GB
- **CPU:** 2 cores
- **Database:** Managed PostgreSQL (AWS RDS, DigitalOcean, etc.)
- **Process Manager:** PM2 (for auto-restart)

---

## 🗄️ Database Setup

### Create Database
```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE tron_wallet;

# Create user (optional)
CREATE USER tron_service WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE tron_wallet TO tron_service;
```

### Initialize Tables

**Method 1: Automatic (Development)**
```bash
# Set NODE_ENV=development
# Tables auto-created on first run
npm run start:dev
```

**Method 2: Manual (Production - Recommended)**
```bash
# Run SQL script
psql -U postgres -d tron_wallet -f src/modules/listeners/database-setup.sql
```

**Verify Tables:**
```bash
psql -U postgres -d tron_wallet -c "\dt"

# Expected output:
#  Schema |         Name          | Type
# --------+-----------------------+-------
#  public | network_sync_state    | table
#  public | processed_deposits    | table
#  public | webhook_queue         | table
```

---

## ⚙️ Environment Configuration

### Production .env Template
```env
# Application
NODE_ENV=production
PORT=3002

# Laravel Integration
LARAVEL_URL=https://your-laravel-domain.com
LARAVEL_API_SECRET=CHANGE_THIS_TO_STRONG_SECRET_KEY

# Auto-start Listener
AUTO_START_LISTENERS=true

# PostgreSQL Database
DB_HOST=your-db-host.com
DB_PORT=5432
DB_USERNAME=tron_service
DB_PASSWORD=your_db_password
DB_DATABASE=tron_wallet
DB_SYNCHRONIZE=false  # IMPORTANT: false in production

# Security
MASTER_PASSWORD=CHANGE_THIS_TO_64_CHAR_HEX_KEY

# TRON RPC (TronGrid)
TRON_RPC_URL=https://api.trongrid.io
TRON_API_TYPE=rest
TRON_API_KEY=your_api_key_1
TRON_API_KEY_2=your_api_key_2
TRON_API_KEY_3=your_api_key_3
```

### Generate Secure Keys
```bash
# Generate MASTER_PASSWORD (64 char hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate LARAVEL_API_SECRET (strong secret)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Environment-Specific Settings

| Setting | Development | Production |
|---------|-------------|------------|
| `NODE_ENV` | development | production |
| `DB_SYNCHRONIZE` | true | **false** (manual migrations) |
| `PORT` | 3001/3002 | 3002 |
| `LARAVEL_URL` | http://localhost:8000 | https://your-domain.com |
| `AUTO_START_LISTENERS` | true | true |

---

## 🚀 Deployment Methods

### Method 1: PM2 (Recommended)

**Install PM2:**
```bash
npm install -g pm2
```

**PM2 Ecosystem File:**
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'trx-wallet-service',
    script: 'dist/main.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3002
    },
    error_file: '/var/log/trx-wallet/error.log',
    out_file: '/var/log/trx-wallet/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    time: true
  }]
};
```

**Deploy Commands:**
```bash
# Build
npm run build

# Start with PM2
pm2 start ecosystem.config.js

# View logs
pm2 logs trx-wallet-service

# Monitor
pm2 monit

# Auto-start on server reboot
pm2 startup
pm2 save

# Restart
pm2 restart trx-wallet-service

# Stop
pm2 stop trx-wallet-service
```

---

### Method 2: Docker (Alternative)

**Dockerfile:**
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3002/api/wallet/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start application
CMD ["npm", "run", "start:prod"]
```

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  trx-wallet:
    build: .
    ports:
      - "3002:3002"
    environment:
      - NODE_ENV=production
      - PORT=3002
      - LARAVEL_URL=${LARAVEL_URL}
      - LARAVEL_API_SECRET=${LARAVEL_API_SECRET}
      - AUTO_START_LISTENERS=true
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_USERNAME=${DB_USERNAME}
      - DB_PASSWORD=${DB_PASSWORD}
      - DB_DATABASE=tron_wallet
      - MASTER_PASSWORD=${MASTER_PASSWORD}
      - TRON_RPC_URL=https://api.trongrid.io
      - TRON_API_TYPE=rest
      - TRON_API_KEY=${TRON_API_KEY}
    depends_on:
      - postgres
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3002/api/wallet/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  postgres:
    image: postgres:14-alpine
    environment:
      - POSTGRES_DB=tron_wallet
      - POSTGRES_USER=${DB_USERNAME}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./src/modules/listeners/database-setup.sql:/docker-entrypoint-initdb.d/init.sql
    restart: unless-stopped

volumes:
  postgres_data:
```

**Deploy with Docker:**
```bash
# Build
docker-compose build

# Start
docker-compose up -d

# View logs
docker-compose logs -f trx-wallet

# Stop
docker-compose down
```

---

### Method 3: Systemd Service (Ubuntu/Debian)

**Service File:** `/etc/systemd/system/trx-wallet.service`
```ini
[Unit]
Description=TRX Wallet Service
After=network.target postgresql.service

[Service]
Type=simple
User=node
WorkingDirectory=/opt/trx-wallet
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=trx-wallet

[Install]
WantedBy=multi-user.target
```

**Deploy Commands:**
```bash
# Enable service
sudo systemctl enable trx-wallet

# Start service
sudo systemctl start trx-wallet

# Check status
sudo systemctl status trx-wallet

# View logs
sudo journalctl -u trx-wallet -f

# Restart
sudo systemctl restart trx-wallet
```

---

## 🔍 Health Checks

### Endpoint
```
GET /api/wallet/health
```

### Expected Response
```json
{
  "success": true,
  "service": "TRX Wallet Service",
  "network": "TRON",
  "status": "operational"
}
```

### Monitoring Script
```bash
#!/bin/bash
# health-check.sh

HEALTH_URL="http://localhost:3002/api/wallet/health"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ $RESPONSE -eq 200 ]; then
  echo "Service is healthy"
  exit 0
else
  echo "Service is down (HTTP $RESPONSE)"
  exit 1
fi
```

---

## 📊 Monitoring & Logs

### Log Locations

**PM2:**
- Error logs: `/var/log/trx-wallet/error.log`
- Output logs: `/var/log/trx-wallet/out.log`

**Docker:**
```bash
docker-compose logs -f trx-wallet
```

**Systemd:**
```bash
sudo journalctl -u trx-wallet -f
```

### Important Log Patterns

**Service Started:**
```
🚀 TRX Wallet Service Started 🚀
Port: 3002
```

**Auto-Start Success:**
```
🚀 Bootstrap: Auto-starting TRON listener...
✅ Loaded 10 addresses from Laravel
```

**Deposit Detected:**
```
💰 Deposit detected: 100 USDT to TW6nF...
📤 Webhook sent to Laravel
```

**Errors to Monitor:**
```
❌ Error fetching addresses from Laravel
❌ Webhook delivery failed (will retry)
❌ Database connection failed
```

---

## 🔒 Security Checklist

### Pre-Deployment
- [ ] Change all default passwords
- [ ] Generate new `MASTER_PASSWORD` (64 char hex)
- [ ] Generate new `LARAVEL_API_SECRET`
- [ ] Ensure secrets match between Laravel and Node.js
- [ ] Remove `.env.example` from production
- [ ] Set `DB_SYNCHRONIZE=false` in production
- [ ] Review TronGrid API key limits

### Firewall Rules
```bash
# Allow only necessary ports
sudo ufw allow 3002/tcp  # Application port
sudo ufw allow 5432/tcp  # PostgreSQL (if external)
sudo ufw allow 22/tcp    # SSH
sudo ufw enable
```

### Database Security
- [ ] Use strong database password
- [ ] Restrict database access to application IP
- [ ] Enable SSL for database connections
- [ ] Regular database backups

---

## 🧪 Post-Deployment Testing

### 1. Health Check
```bash
curl http://your-server:3002/api/wallet/health
```

### 2. Generate Mnemonic (One Time)
```bash
curl -X POST http://your-server:3002/api/wallet/generate-mnemonic
# Save the encrypted_mnemonic to Laravel database
```

### 3. Generate Test Address
```bash
curl -X POST http://your-server:3002/api/wallet/get-address \
  -H "Content-Type: application/json" \
  -d '{
    "encrypted_mnemonic": {...},
    "index": 999,
    "user_id": 999
  }'
```

### 4. Check Database
```bash
psql -d tron_wallet -c "SELECT * FROM network_sync_state;"
```

### 5. Monitor Logs
```bash
# PM2
pm2 logs trx-wallet-service

# Docker
docker-compose logs -f

# Systemd
sudo journalctl -u trx-wallet -f
```

---

## 🔄 Backup & Recovery

### Database Backup
```bash
# Daily backup script
#!/bin/bash
BACKUP_DIR="/var/backups/tron_wallet"
DATE=$(date +%Y%m%d_%H%M%S)

pg_dump -U tron_service tron_wallet > "$BACKUP_DIR/backup_$DATE.sql"

# Keep only last 30 days
find $BACKUP_DIR -name "backup_*.sql" -mtime +30 -delete
```

### Database Restore
```bash
psql -U tron_service tron_wallet < /var/backups/tron_wallet/backup_20260317_010000.sql
```

---

## 📞 Support & Troubleshooting

### Common Issues

**Issue: Port already in use**
```bash
# Find process
lsof -ti:3002

# Kill process
kill -9 $(lsof -ti:3002)
```

**Issue: Database connection failed**
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Check connection
psql -h DB_HOST -U DB_USERNAME -d tron_wallet
```

**Issue: Listener not detecting deposits**
```bash
# Check logs for TronGrid API errors
# Verify API keys are valid
# Check addresses are registered
```

---

## 📋 Deployment Checklist

### Pre-Deployment
- [ ] Code built successfully (`npm run build`)
- [ ] All tests passed
- [ ] `.env` file configured for production
- [ ] Database created and tables initialized
- [ ] Secrets generated and secured
- [ ] Firewall rules configured

### Deployment
- [ ] Application deployed to server
- [ ] Process manager configured (PM2/Docker/Systemd)
- [ ] Service started and running
- [ ] Health check returns 200
- [ ] Database connection successful
- [ ] Auto-start listeners enabled

### Post-Deployment
- [ ] Master mnemonic generated and stored
- [ ] Test address generation works
- [ ] Laravel webhook endpoint accessible
- [ ] Logs are being written correctly
- [ ] Monitoring/alerts configured
- [ ] Backup script scheduled

### Production Ready
- [ ] Real deposit tested successfully
- [ ] Webhook delivery confirmed
- [ ] Duplicate prevention verified
- [ ] Service restart tested
- [ ] Documentation provided to team

---

## 🎯 Performance Tuning

### Node.js Optimization
```javascript
// ecosystem.config.js
max_memory_restart: '1G',
node_args: '--max-old-space-size=1024'
```

### Database Optimization
```sql
-- Create indexes (already in setup script)
CREATE INDEX idx_processed_deposits_txhash ON processed_deposits("txHash");
CREATE INDEX idx_webhook_queue_status ON webhook_queue(status);
```

### TronGrid Rate Limits
- Free tier: 500k requests/day per API key
- Using 3 keys = 1.5M requests/day
- Polling every 5 minutes = ~8.6k requests/day
- Safe margin for growth

---

## 📊 Monitoring Metrics

### Key Metrics to Monitor
- **Health check status** (every 1 minute)
- **Database connections** (active/idle)
- **Memory usage** (should stay under 1GB)
- **TronGrid API calls** (track rate limit)
- **Webhook success rate** (should be >95%)
- **Deposit processing time** (average latency)

### Alerting Thresholds
- Health check fails 3 times → Alert
- Memory usage >90% → Alert
- Webhook failure rate >5% → Alert
- Database connection pool exhausted → Alert

---

**Deployment Support:** Check logs and `LARAVEL_INTEGRATION_README.md` for troubleshooting.
