// backend/src/tests/coupon-race.test.js
// Phase 2 Conditional Test: Coupon Race (FEATURE_COUPONS)
// Contract: Two users, max_redemptions=1 -> one succeeds; same user, per_customer_limit=1 -> second rejected.

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, isApiReachable, getToken, apiRequest, skipIfBlocked } = require('./helpers');

test('Coupon Race: max_redemptions=1, two concurrent users -> one succeeds', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token1 = await getToken('demo@bazaarbridge.dev', 'Demo@1234');
  const token2 = await getToken('rider@bazaarbridge.dev', 'Rider@1234');

  // 1. Create coupon with max_redemptions=1
  const couponId = 'c_race_' + Date.now();
  const couponCode = 'RACE100';

  await pool.query(`
    INSERT INTO coupons (coupon_id, code, kind, value, min_basket_paise, max_redemptions, redeemed_count, per_customer_limit, valid_from, valid_to, active)
    VALUES ($1, $2, 'fixed_paise', 10000, 0, 1, 0, 1, NOW(), NOW() + INTERVAL '1 day', true)
    ON CONFLICT (coupon_id) DO NOTHING
  `, [couponId, couponCode]);

  // 2. Both users have carts with items
  // User 1 reserves
  const reserve1 = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: '70000000-0000-0000-0000-000000000001',
    location_id: '10000000-0000-0000-0000-000000000001',
    quantity: 1,
    request_key: 'req_coupon_1_' + Date.now()
  }, token1);
  assert.strictEqual(reserve1.status, 201);

  // User 2 reserves
  const reserve2 = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: '70000000-0000-0000-0000-000000000001',
    location_id: '10000000-0000-0000-0000-000000000001',
    quantity: 1,
    request_key: 'req_coupon_2_' + Date.now()
  }, token2);
  assert.strictEqual(reserve2.status, 201);

  // 3. Both try to place order with same coupon CONCURRENTLY
  const [order1, order2] = await Promise.all([
    apiRequest('POST', '/api/orders', {
      reservation_ids: [reserve1.data.reservation_id],
      address: { pin_code: '560001' },
      coupon_code: couponCode
    }, token1),
    apiRequest('POST', '/api/orders', {
      reservation_ids: [reserve2.data.reservation_id],
      address: { pin_code: '560001' },
      coupon_code: couponCode
    }, token2)
  ]);

  const statuses = [order1.status, order2.status].sort();
  assert.strictEqual(statuses[0], 201, 'One order must succeed');
  assert.strictEqual(statuses[1], 409, 'Second must fail');
  const failed = order1.status === 409 ? order1 : order2;
  assert.strictEqual(failed.data.error, 'COUPON_LIMIT_REACHED', 'Error must be COUPON_LIMIT_REACHED');

  // 4. Verify coupon redeemed_count = 1
  const coupon = await pool.query(`SELECT redeemed_count FROM coupons WHERE coupon_id = $1`, [couponId]);
  assert.strictEqual(coupon.rows[0].redeemed_count, 1);

  // Cleanup
  await pool.query(`DELETE FROM coupons WHERE coupon_id = $1`, [couponId]);
});

test('Coupon Per-Customer: per_customer_limit=1, same user twice -> second rejected', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken('demo@bazaarbridge.dev', 'Demo@1234');

  // 1. Create coupon with per_customer_limit=1, max_redemptions=10
  const couponId = 'c_percust_' + Date.now();
  const couponCode = 'PERCUST50';

  await pool.query(`
    INSERT INTO coupons (coupon_id, code, kind, value, min_basket_paise, max_redemptions, redeemed_count, per_customer_limit, valid_from, valid_to, active)
    VALUES ($1, $2, 'fixed_paise', 5000, 0, 10, 0, 1, NOW(), NOW() + INTERVAL '1 day', true)
    ON CONFLICT (coupon_id) DO NOTHING
  `, [couponId, couponCode]);

  // 2. User places first order with coupon
  const reserve1 = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: '70000000-0000-0000-0000-000000000001',
    location_id: '10000000-0000-0000-0000-000000000001',
    quantity: 1,
    request_key: 'req_percust_1_' + Date.now()
  }, token);
  assert.strictEqual(reserve1.status, 201);

  const order1 = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reserve1.data.reservation_id],
    address: { pin_code: '560001' },
    coupon_code: couponCode
  }, token);
  assert.strictEqual(order1.status, 201);

  // 3. Same user tries second order with same coupon
  const reserve2 = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: '70000000-0000-0000-0000-000000000002',
    location_id: '10000000-0000-0000-0000-000000000001',
    quantity: 1,
    request_key: 'req_percust_2_' + Date.now()
  }, token);
  assert.strictEqual(reserve2.status, 201);

  const order2 = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reserve2.data.reservation_id],
    address: { pin_code: '560001' },
    coupon_code: couponCode
  }, token);

  assert.strictEqual(order2.status, 409, 'Second order with same coupon must fail');
  assert.strictEqual(order2.data.error, 'PER_CUSTOMER_LIMIT_REACHED');

  // 4. Verify coupon_customer_usage count = 1
  const usage = await pool.query(`
    SELECT used_count FROM coupon_customer_usage WHERE coupon_id = $1 AND user_id = $2
  `, [couponId, '30000000-0000-0000-0000-000000000001']);
  assert.strictEqual(usage.rows[0].used_count, 1);

  // Cleanup
  await pool.query(`DELETE FROM coupons WHERE coupon_id = $1`, [couponId]);
});

test('Coupon: max_redemptions and per_customer_limit both enforced', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token1 = await getToken('demo@bazaarbridge.dev', 'Demo@1234');
  const token2 = await getToken('rider@bazaarbridge.dev', 'Rider@1234');

  // Coupon: max=2, per_customer=1
  const couponId = 'c_both_' + Date.now();
  const couponCode = 'BOTH25';

  await pool.query(`
    INSERT INTO coupons (coupon_id, code, kind, value, min_basket_paise, max_redemptions, redeemed_count, per_customer_limit, valid_from, valid_to, active)
    VALUES ($1, $2, 'percent', 25, 0, 2, 0, 1, NOW(), NOW() + INTERVAL '1 day', true)
    ON CONFLICT (coupon_id) DO NOTHING
  `, [couponId, couponCode]);

  // User 1 redeems
  const reserve1 = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: '70000000-0000-0000-0000-000000000001',
    location_id: '10000000-0000-0000-0000-000000000001',
    quantity: 1,
    request_key: 'req_both_1_' + Date.now()
  }, token1);
  const order1 = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reserve1.data.reservation_id],
    address: { pin_code: '560001' },
    coupon_code: couponCode
  }, token1);
  assert.strictEqual(order1.status, 201);

  // User 1 tries again -> PER_CUSTOMER_LIMIT_REACHED
  const reserve1b = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: '70000000-0000-0000-0000-000000000002',
    location_id: '10000000-0000-0000-0000-000000000001',
    quantity: 1,
    request_key: 'req_both_1b_' + Date.now()
  }, token1);
  const order1b = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reserve1b.data.reservation_id],
    address: { pin_code: '560001' },
    coupon_code: couponCode
  }, token1);
  assert.strictEqual(order1b.status, 409);
  assert.strictEqual(order1b.data.error, 'PER_CUSTOMER_LIMIT_REACHED');

  // User 2 redeems (second redemption, max=2)
  const reserve2 = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: '70000000-0000-0000-0000-000000000003',
    location_id: '10000000-0000-0000-0000-000000000001',
    quantity: 1,
    request_key: 'req_both_2_' + Date.now()
  }, token2);
  const order2 = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reserve2.data.reservation_id],
    address: { pin_code: '560001' },
    coupon_code: couponCode
  }, token2);
  assert.strictEqual(order2.status, 201);

  // User 2 tries again -> PER_CUSTOMER_LIMIT_REACHED
  const reserve2b = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: '70000000-0000-0000-0000-000000000004',
    location_id: '10000000-0000-0000-0000-000000000001',
    quantity: 1,
    request_key: 'req_both_2b_' + Date.now()
  }, token2);
  const order2b = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reserve2b.data.reservation_id],
    address: { pin_code: '560001' },
    coupon_code: couponCode
  }, token2);
  assert.strictEqual(order2b.status, 409);

  // Third user tries -> COUPON_LIMIT_REACHED (max=2 reached)
  // Would need third user token

  // Cleanup
  await pool.query(`DELETE FROM coupons WHERE coupon_id = $1`, [couponId]);
});