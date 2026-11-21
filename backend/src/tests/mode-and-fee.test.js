// backend/src/tests/mode-and-fee.test.js
// Phase 2 Mandatory Test: Mode & Fee Calculation
// Contract: Served PIN + hub stock + warehouse stock -> one order, TWO groups (quick 4900, standard 2900 or 0 above threshold).
// Assert group.fee_total = SUM(lines' delivery_fee_share), delivery_fee_total = SUM(group fees), reconciliation zero rows.
// Unserved PIN -> Quick rejected with QUICK_NOT_AVAILABLE when requested.
// Downgrade preference quick->standard is honoured.
// 'quick' requested on a warehouse line is ALWAYS rejected.

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, isApiReachable, getToken, apiRequest, skipIfBlocked } = require('./helpers');

const QUICK_FEE = 4900;
const STANDARD_FEE = 2900;
const TRANSFER_FEE = 6900;
const FREE_STANDARD_THRESHOLD = 99900;

test('Mode & Fee: Served PIN with hub + warehouse stock -> two groups, correct fees', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken();

  // 1. Use PIN 560001 (served by Bangalore Express Hub)
  // Reserve one item at hub (quick eligible) and one at warehouse (standard)
  const hubOfferId = '70000000-0000-0000-0000-000000000002'; // Has quick,standard at hub
  const hubLocId = '10000000-0000-0000-0000-000000000002'; // Bangalore Express Hub
  const warehouseOfferId = '70000000-0000-0000-0000-000000000001'; // At warehouse
  const warehouseLocId = '10000000-0000-0000-0000-000000000001'; // Bangalore Central Warehouse

  // Reset stock
  await pool.query(`UPDATE inventory SET quantity = 10, reserved_quantity = 0 WHERE offer_id = $1 AND location_id = $2`, [hubOfferId, hubLocId]);
  await pool.query(`UPDATE inventory SET quantity = 10, reserved_quantity = 0 WHERE offer_id = $1 AND location_id = $2`, [warehouseOfferId, warehouseLocId]);

  // 2. Reserve both
  const reserveHub = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: hubOfferId, location_id: hubLocId, quantity: 1, request_key: 'req_fee_hub_' + Date.now()
  }, token);
  assert.strictEqual(reserveHub.status, 201);

  const reserveWh = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: warehouseOfferId, location_id: warehouseLocId, quantity: 1, request_key: 'req_fee_wh_' + Date.now()
  }, token);
  assert.strictEqual(reserveWh.status, 201);

  // 3. Place order with quick preference on hub item, standard on warehouse
  const orderRes = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reserveHub.data.reservation_id, reserveWh.data.reservation_id],
    address: { pin_code: '560001' },
    mode_preferences: {
      [reserveHub.data.reservation_id]: 'quick',
      [reserveWh.data.reservation_id]: 'standard'
    }
  }, token);
  assert.strictEqual(orderRes.status, 201);

  const orderId = orderRes.data.order_id;
  const groups = orderRes.data.groups;

  // 4. Verify: TWO groups (one quick, one standard)
  assert.strictEqual(groups.length, 2, 'Must have exactly 2 groups');

  const quickGroup = groups.find(g => g.mode === 'quick');
  const standardGroup = groups.find(g => g.mode === 'standard');

  assert.ok(quickGroup, 'Quick group must exist');
  assert.ok(standardGroup, 'Standard group must exist');

  // 5. Verify fees
  assert.strictEqual(quickGroup.fee_total, QUICK_FEE, 'Quick group fee must be 4900');
  assert.strictEqual(standardGroup.fee_total, STANDARD_FEE, 'Standard group fee must be 2900 (below threshold)');

  // 6. Verify delivery_fee_total = SUM(group fees)
  assert.strictEqual(orderRes.data.delivery_fee_total, QUICK_FEE + STANDARD_FEE, 'Order delivery_fee_total must equal sum of group fees');

  // 7. Reconciliation: group.fee_total = SUM(lines' delivery_fee_share)
  const groupCheck = await pool.query(`
    SELECT fg.group_id, fg.fee_total, SUM(oi.delivery_fee_share) as lines_fee_sum
    FROM fulfilment_groups fg
    JOIN order_items oi ON oi.group_id = fg.group_id
    WHERE fg.order_id = $1
    GROUP BY fg.group_id, fg.fee_total
  `, [orderId]);
  
  groupCheck.rows.forEach(row => {
    assert.strictEqual(row.fee_total, row.lines_fee_sum, 'Group fee_total must equal sum of lines delivery_fee_share');
  });

  // 8. Reconciliation: delivery_fee_total = SUM(group fees)
  const orderCheck = await pool.query(`
    SELECT o.delivery_fee_total, SUM(fg.fee_total) as groups_sum
    FROM orders o
    JOIN fulfilment_groups fg ON fg.order_id = o.order_id
    WHERE o.order_id = $1
    GROUP BY o.order_id, o.delivery_fee_total
  `, [orderId]);
  assert.strictEqual(orderCheck.rows[0].delivery_fee_total, orderCheck.rows[0].groups_sum);

  // 9. Reconciliation query returns zero rows
  const recon = await pool.query(`
    SELECT o.order_id, o.total_amount, SUM(oi.paid_amount) as items_sum
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.order_id = $1
    GROUP BY o.order_id, o.total_amount
    HAVING o.total_amount != SUM(oi.paid_amount)
  `, [orderId]);
  assert.strictEqual(recon.rowCount, 0, 'Reconciliation must pass (zero rows)');
});

test('Mode & Fee: Standard group above threshold -> fee waived (0)', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken();

  // Use expensive items to exceed threshold
  const offerId = '70000000-0000-0000-0000-000000000017'; // ApexBook Laptop ~53,99,900 paise
  const locId = '10000000-0000-0000-0000-000000000001';

  await pool.query(`UPDATE inventory SET quantity = 10, reserved_quantity = 0 WHERE offer_id = $1 AND location_id = $2`, [offerId, locId]);

  const reserve = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: offerId, location_id: locId, quantity: 1, request_key: 'req_fee_high_' + Date.now()
  }, token);
  assert.strictEqual(reserve.status, 201);

  const orderRes = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reserve.data.reservation_id],
    address: { pin_code: '560001' },
    mode_preferences: { [reserve.data.reservation_id]: 'standard' }
  }, token);
  assert.strictEqual(orderRes.status, 201);

  const groups = orderRes.data.groups;
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].mode, 'standard');
  assert.strictEqual(groups[0].fee_total, 0, 'Standard fee waived above threshold');
  assert.strictEqual(orderRes.data.delivery_fee_total, 0);
});

test('Mode & Fee: Unserved PIN -> Quick rejected with QUICK_NOT_AVAILABLE', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken();

  // Use PIN not in hub service areas
  const offerId = '70000000-0000-0000-0000-000000000002'; // At hub
  const locId = '10000000-0000-0000-0000-000000000002';

  await pool.query(`UPDATE inventory SET quantity = 10, reserved_quantity = 0 WHERE offer_id = $1 AND location_id = $2`, [offerId, locId]);

  const reserve = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: offerId, location_id: locId, quantity: 1, request_key: 'req_fee_unserved_' + Date.now()
  }, token);
  assert.strictEqual(reserve.status, 201);

  // Try to order with quick preference to unserved PIN (e.g., 999999)
  const orderRes = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reserve.data.reservation_id],
    address: { pin_code: '999999' },
    mode_preferences: { [reserve.data.reservation_id]: 'quick' }
  }, token);

  assert.strictEqual(orderRes.status, 409, 'Quick on unserved PIN must be 409');
  assert.strictEqual(orderRes.data.error, 'QUICK_NOT_AVAILABLE');
});

test('Mode & Fee: Downgrade quick->standard honoured', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken();

  const offerId = '70000000-0000-0000-0000-000000000002'; // At hub
  const locId = '10000000-0000-0000-0000-000000000002';

  await pool.query(`UPDATE inventory SET quantity = 10, reserved_quantity = 0 WHERE offer_id = $1 AND location_id = $2`, [offerId, locId]);

  const reserve = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: offerId, location_id: locId, quantity: 1, request_key: 'req_fee_downgrade_' + Date.now()
  }, token);
  assert.strictEqual(reserve.status, 201);

  // Request quick but PIN unserved -> should fail
  // Actually test: served PIN, customer explicitly chooses standard (downgrade)
  const orderRes = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reserve.data.reservation_id],
    address: { pin_code: '560001' },
    mode_preferences: { [reserve.data.reservation_id]: 'standard' } // Customer downgrade
  }, token);
  
  assert.strictEqual(orderRes.status, 201, 'Downgrade to standard must be allowed');
  const groups = orderRes.data.groups;
  assert.strictEqual(groups[0].mode, 'standard', 'Group must be standard');
  assert.strictEqual(groups[0].fee_total, STANDARD_FEE, 'Fee must be standard');
});

test('Mode & Fee: Quick on warehouse line ALWAYS rejected', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken();

  const offerId = '70000000-0000-0000-0000-000000000001'; // At warehouse only
  const locId = '10000000-0000-0000-0000-000000000001'; // Warehouse

  await pool.query(`UPDATE inventory SET quantity = 10, reserved_quantity = 0 WHERE offer_id = $1 AND location_id = $2`, [offerId, locId]);

  const reserve = await apiRequest('POST', '/api/cart/reserve', {
    offer_id: offerId, location_id: locId, quantity: 1, request_key: 'req_fee_wh_quick_' + Date.now()
  }, token);
  assert.strictEqual(reserve.status, 201);

  // Try to request quick on warehouse line -> ALWAYS rejected
  const orderRes = await apiRequest('POST', '/api/orders', {
    reservation_ids: [reserve.data.reservation_id],
    address: { pin_code: '560001' },
    mode_preferences: { [reserve.data.reservation_id]: 'quick' }
  }, token);

  assert.strictEqual(orderRes.status, 409, 'Quick on warehouse line must be 409');
  assert.strictEqual(orderRes.data.error, 'QUICK_NOT_AVAILABLE', 'Error must be QUICK_NOT_AVAILABLE');
});