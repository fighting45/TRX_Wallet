// Quick test script to verify TronGrid API and listener logic
const axios = require('axios');

const TRON_RPC_URL = 'https://api.trongrid.io';
const TRON_API_KEY = '060baab4-3c93-4ae6-96ea-7a3c5c11afab';

// Test address (USDT contract - has lots of activity)
const TEST_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

async function testTronGridConnection() {
  console.log('🧪 Testing TronGrid API Connection...\n');

  try {
    // Test 1: Get current block
    console.log('1️⃣  Testing: Get current block...');
    const blockResponse = await axios.post(
      `${TRON_RPC_URL}/wallet/getnowblock`,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          'TRON-PRO-API-KEY': TRON_API_KEY,
        },
      }
    );
    const currentBlock = blockResponse.data.block_header.raw_data.number;
    console.log(`   ✅ Current block: ${currentBlock}\n`);

    // Test 2: Get transactions for address
    console.log('2️⃣  Testing: Get transactions for address...');
    const txResponse = await axios.get(
      `${TRON_RPC_URL}/v1/accounts/${TEST_ADDRESS}/transactions`,
      {
        params: { limit: 3 },
        headers: {
          'TRON-PRO-API-KEY': TRON_API_KEY,
        },
      }
    );

    const transactions = txResponse.data.data || [];
    console.log(`   ✅ Found ${transactions.length} transactions`);

    if (transactions.length > 0) {
      const latestTx = transactions[0];
      console.log(`   📄 Latest TX: ${latestTx.txID.substring(0, 20)}...`);
      console.log(`   📦 Block: ${latestTx.blockNumber}`);
      console.log(`   🕐 Time: ${new Date(latestTx.block_timestamp).toLocaleString()}\n`);
    }

    // Test 3: Get transaction info (for TRC20 detection)
    if (transactions.length > 0) {
      console.log('3️⃣  Testing: Get transaction info...');
      const txHash = transactions[0].txID;

      const txInfoResponse = await axios.post(
        `${TRON_RPC_URL}/wallet/gettransactioninfobyid`,
        { value: txHash },
        {
          headers: {
            'Content-Type': 'application/json',
            'TRON-PRO-API-KEY': TRON_API_KEY,
          },
        }
      );

      const txInfo = txInfoResponse.data;
      console.log(`   ✅ Transaction info retrieved`);

      if (txInfo.log && txInfo.log.length > 0) {
        console.log(`   📋 Found ${txInfo.log.length} event logs`);

        // Check for Transfer events
        const transferLogs = txInfo.log.filter(
          log => log.topics && log.topics[0] === 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
        );

        if (transferLogs.length > 0) {
          console.log(`   💸 Found ${transferLogs.length} Transfer event(s) (TRC20)`);
        }
      }
      console.log();
    }

    // Test 4: Test TRC20 token info (USDT contract)
    console.log('4️⃣  Testing: Get TRC20 token info (USDT)...');
    const usdtContract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

    // Get decimals
    const decimalsResponse = await axios.post(
      `${TRON_RPC_URL}/wallet/triggerconstantcontract`,
      {
        owner_address: '410000000000000000000000000000000000000000',
        contract_address: usdtContract,
        function_selector: 'decimals()',
        parameter: '',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'TRON-PRO-API-KEY': TRON_API_KEY,
        },
      }
    );

    if (decimalsResponse.data?.constant_result?.[0]) {
      const decimals = parseInt(decimalsResponse.data.constant_result[0], 16);
      console.log(`   ✅ USDT decimals: ${decimals}\n`);
    }

    console.log('🎉 All TronGrid API tests passed!\n');
    console.log('📊 Rate Limit Info:');
    console.log(`   API Key: ${TRON_API_KEY.substring(0, 20)}...`);
    console.log(`   Limit: 500,000 requests/day`);
    console.log(`   Keys available: 3 (can rotate if needed)\n`);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Response:', error.response.data);
    }
    process.exit(1);
  }
}

// Run test
testTronGridConnection()
  .then(() => {
    console.log('✅ Test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  });
