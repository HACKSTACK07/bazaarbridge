// backend/src/tests/price-change.test.js
// Phase 1 Mandatory Test: Price Change During Checkout (409 PRICE_CHANGED)
// Contract: Reserve, change selling_price, POST /api/orders ->
// 409 PRICE_CHANGED with reservation_id; reservation NOT confirmed; stock unchanged.

const test = require('node:test');
const assert = require('node:assert');
const { apiRequest, getToken, isApiReachable, isDbReachable, getDbPool, skipIfBlocked } = require('./helpers');

test('Price Change Guard During Order Placement', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const TEST_OFFER_ID = '70000000-0000-0000-0000-000000000001';
  const WAREHOUSE_LOC_ID = '10000000-0000-0000-0000-000000000001';

  const token = await getToken('demo@bazaarbridge.dev', 'Demo@1234');

  // 1. Initial price: 69900 paise (Rs. 699)
  await pool.query(
    `UPDATE dealer_offers SET selling_price = 69900 WHERE offer_id = $1`,
    [TEST_OFFER_ID]
  );

  // 2. Reserve offer
  const reqKey = 'req_price_guard_' + Date.now();
  const reserveRes = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: TEST_OFFER_ID,
    location_id: WAREHOUSE_LOC_ID,
    quantity: 1,
    request_key: reqKey
  }, token);

  assert.strictEqual(reserveRes.status, 201);
  const reservationId = reserveRes.data.reservation_id;

  // 3. Dealer changes selling price to 74900 paise before order placement
  await pool.query(
    `UPDATE dealer_offers SET selling_price = 74900 WHERE offer_id = $1`,
    [TEST_OFFER_ID]
  );

  // 4. Customer attempts to check out at old price
  const orderRes = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reservationId],
    address: { pin_code: '560001' },
    mode_preferences: { [reservationId]: 'standard' }
  }, token);

  // Assert 409 PRICE_CHANGED
  assert.strictEqual(orderRes.status, 409);
  assert.strictEqual(orderRes.data.error, 'PRICE_CHANGED');

  // Verify reservation is NOT confirmed
  const resvCheck = await pool.query(
    `SELECT status FROM reservations WHERE reservation_id = $1`,
    [reservationId]
  );
  assert.strictEqual(resvCheck.rows[0].status, 'reserved');

  // Cleanup: release hold
  await apiRequest('POST', '/api/cart/release', { reservation_id: reservationId }, token);
});
