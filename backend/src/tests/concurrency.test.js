// backend/src/tests/concurrency.test.js
// Phase 1 Mandatory Test: Simultaneous Last-Unit Reservation
// Contract: Two users via getToken(); 2 simultaneous POST /api/cart/reserve for the last unit,
// distinct request_keys -> exactly ONE 201 and ONE 409 OUT_OF_STOCK; reserved_quantity = 1.

const test = require('node:test');
const assert = require('node:assert');
const { apiRequest, getToken, isApiReachable, isDbReachable, getDbPool, skipIfBlocked } = require('./helpers');

test('Concurrent Last-Unit Reservation Test', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const LAST_UNIT_OFFER_ID = '70000000-0000-0000-0000-000000000006';
  const WAREHOUSE_LOC_ID = '10000000-0000-0000-0000-000000000001';

  // 1. Reset initial stock: quantity = 1, reserved_quantity = 0
  await pool.query(
    `UPDATE inventory SET quantity = 1, reserved_quantity = 0
     WHERE offer_id = $1 AND location_id = $2`,
    [LAST_UNIT_OFFER_ID, WAREHOUSE_LOC_ID]
  );

  // 2. Obtain tokens for two distinct users
  const token1 = await getToken('demo@bazaarbridge.dev', 'Demo@1234');
  const token2 = await getToken('rider@bazaarbridge.dev', 'Rider@1234');

  const reqKey1 = 'req_race_' + Date.now() + '_user1';
  const reqKey2 = 'req_race_' + Date.now() + '_user2';

  // 3. Fire 2 simultaneous POST /api/cart/reserve calls for the last unit
  const [res1, res2] = await Promise.all([
    apiRequest('POST', '/api/cart/reserve', {
      offer_id: LAST_UNIT_OFFER_ID,
      location_id: WAREHOUSE_LOC_ID,
      quantity: 1,
      request_key: reqKey1
    }, token1),
    apiRequest('POST', '/api/cart/reserve', {
      offer_id: LAST_UNIT_OFFER_ID,
      location_id: WAREHOUSE_LOC_ID,
      quantity: 1,
      request_key: reqKey2
    }, token2)
  ]);

  const statuses = [res1.status, res2.status].sort();

  // Invariant 1: Exactly ONE 201 Created and ONE 409 Conflict
  assert.strictEqual(statuses[0], 201, `Expected one 201 Created, got ${res1.status} and ${res2.status}`);
  assert.strictEqual(statuses[1], 409, `Expected one 409 Conflict, got ${res1.status} and ${res2.status}`);

  // Invariant 2: The 409 returns OUT_OF_STOCK
  const conflictRes = res1.status === 409 ? res1 : res2;
  assert.strictEqual(conflictRes.data.error, 'OUT_OF_STOCK');

  // Invariant 3: Database truth: reserved_quantity is exactly 1
  const check = await pool.query(
    `SELECT quantity, reserved_quantity FROM inventory
     WHERE offer_id = $1 AND location_id = $2`,
    [LAST_UNIT_OFFER_ID, WAREHOUSE_LOC_ID]
  );
  assert.strictEqual(check.rows[0].quantity, 1);
  assert.strictEqual(check.rows[0].reserved_quantity, 1);
});
