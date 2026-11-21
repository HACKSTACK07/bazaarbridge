// backend/src/tests/order-reconciliation.test.js
// Phase 1 Test: Order Integrity - Reconciliation Query Returns Zero Rows
// Contract: Every order line maps 1:1 to reservation; no duplicate/orphaned reservations

const test = require('node:test');
const assert = require('node:assert');
const { apiRequest, getToken, isApiReachable, isDbReachable, getDbPool, skipIfBlocked } = require('./helpers');

test('Order Reconciliation: Zero orphaned order items', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // Reconciliation query: order_items with missing references
  const res = await pool.query(`
    SELECT oi.order_item_id
    FROM order_items oi
    LEFT JOIN reservations r ON oi.reservation_id = r.reservation_id
    LEFT JOIN dealer_offers o ON oi.offer_id = o.offer_id
    LEFT JOIN dealers d ON oi.dealer_id = d.dealer_id
    LEFT JOIN stock_locations l ON oi.stock_location_id = l.location_id
    WHERE r.reservation_id IS NULL
       OR o.offer_id IS NULL
       OR d.dealer_id IS NULL
       OR l.location_id IS NULL
  `);

  assert.strictEqual(res.rowCount, 0, 'No order_items should have missing references');
});

test('Order Reconciliation: Zero duplicate reservations per order', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // Check for reservations referenced by multiple order_items
  const res = await pool.query(`
    SELECT oi.reservation_id, COUNT(*) as cnt
    FROM order_items oi
    WHERE oi.reservation_id IS NOT NULL
    GROUP BY oi.reservation_id
    HAVING COUNT(*) > 1
  `);

  assert.strictEqual(res.rowCount, 0, 'No reservation should be referenced by multiple order_items');
});

test('Order Reconciliation: Zero reservations reused across orders', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // Check for confirmed reservations used in multiple orders
  const res = await pool.query(`
    SELECT r.reservation_id, COUNT(DISTINCT oi.order_id) as order_count
    FROM reservations r
    JOIN order_items oi ON oi.reservation_id = r.reservation_id
    WHERE r.status = 'confirmed'
    GROUP BY r.reservation_id
    HAVING COUNT(DISTINCT oi.order_id) > 1
  `);

  assert.strictEqual(res.rowCount, 0, 'No confirmed reservation should belong to multiple orders');
});

test('Order Reconciliation: All confirmed reservations have stock_finalised=true', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  const res = await pool.query(`
    SELECT oi.order_item_id, r.reservation_id, r.status, oi.stock_finalised
    FROM order_items oi
    JOIN reservations r ON oi.reservation_id = r.reservation_id
    WHERE r.status = 'confirmed' AND oi.stock_finalised = false
  `);

  assert.strictEqual(res.rowCount, 0, 'All confirmed reservations must have stock_finalised=true');
});

test('Order Reconciliation: Fulfilment groups match order lines 1:1', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // Every order_item should have a group_id, every group should have order_items
  const orphanItems = await pool.query(`
    SELECT oi.order_item_id
    FROM order_items oi
    LEFT JOIN fulfilment_groups fg ON oi.group_id = fg.group_id
    WHERE oi.group_id IS NULL OR fg.group_id IS NULL
  `);
  assert.strictEqual(orphanItems.rowCount, 0, 'No order_item should lack a fulfilment_group');

  const emptyGroups = await pool.query(`
    SELECT fg.group_id
    FROM fulfilment_groups fg
    LEFT JOIN order_items oi ON oi.group_id = fg.group_id
    WHERE oi.group_id IS NULL
  `);
  assert.strictEqual(emptyGroups.rowCount, 0, 'No fulfilment_group should lack order_items');
});

test('Order Reconciliation: Payment amounts match order totals', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // SUM(order_items.paid_amount) = orders.total_amount
  const res = await pool.query(`
    SELECT o.order_id, o.total_amount, SUM(oi.paid_amount) as items_sum
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    GROUP BY o.order_id, o.total_amount
    HAVING o.total_amount != SUM(oi.paid_amount)
  `);

  assert.strictEqual(res.rowCount, 0, 'Order total_amount must equal sum of order_items.paid_amount');
});