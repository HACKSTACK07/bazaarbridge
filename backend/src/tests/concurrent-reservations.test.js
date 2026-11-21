const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');

const PG_URI = process.env.PG_URI;

function getPool() {
  if (!PG_URI) {
    throw new Error('PG_URI environment variable not set. Cannot run integration tests against Aiven PostgreSQL.');
  }
  return new Pool({ connectionString: PG_URI });
}

const OFFER_ID_1_UNIT = '70000000-0000-0000-0000-000000000006';
const LOCATION_ID_WAREHOUSE = '10000000-0000-0000-0000-000000000001';
const USER_IDS = [
  '30000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000003',
  '30000000-0000-0000-0000-000000000004',
  '30000000-0000-0000-0000-000000000005',
  '30000000-0000-0000-0000-000000000006',
  '30000000-0000-0000-0000-000000000007',
  '30000000-0000-0000-0000-000000000008',
  '30000000-0000-0000-0000-000000000009',
  '30000000-0000-0000-0000-000000000010',
];

async function reserveOneUnit(pool, userId, requestKey) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `INSERT INTO reservations (offer_id, location_id, user_id, quantity, price_paise, status, expires_at, request_key)
       VALUES ($1, $2, $3, 1,
         (SELECT selling_price FROM dealer_offers WHERE offer_id = $1),
         'reserved', NOW() + INTERVAL '10 minutes', $4)
       ON CONFLICT DO NOTHING
       RETURNING reservation_id`,
      [OFFER_ID_1_UNIT, LOCATION_ID_WAREHOUSE, userId, requestKey]
    );
    if (res.rowCount === 1) {
      await client.query(
        `UPDATE inventory SET reserved_quantity = reserved_quantity + 1
         WHERE offer_id = $1 AND location_id = $2
         AND quantity - reserved_quantity >= 1`,
        [OFFER_ID_1_UNIT, LOCATION_ID_WAREHOUSE]
      );
      await client.query('COMMIT');
      return { success: true, reservationId: res.rows[0].reservation_id };
    }
    await client.query('ROLLBACK');
    return { success: false };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

test('Concurrent reservations: only one of 10 simultaneous requests succeeds for 1-unit offer', { skip: !PG_URI }, async () => {
  const pool = getPool();
  try {
    await pool.query(`UPDATE inventory SET quantity = 1, reserved_quantity = 0 WHERE offer_id = $1 AND location_id = $2`, [OFFER_ID_1_UNIT, LOCATION_ID_WAREHOUSE]);

    const promises = USER_IDS.map((userId, i) => reserveOneUnit(pool, userId, `req-${i}`));
    const results = await Promise.all(promises);

    const successCount = results.filter(r => r.success).length;
    assert.strictEqual(successCount, 1, `Exactly 1 reservation should succeed, got ${successCount}`);

    const inv = await pool.query(`SELECT quantity, reserved_quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [OFFER_ID_1_UNIT, LOCATION_ID_WAREHOUSE]);
    assert.strictEqual(inv.rows[0].quantity, 1);
    assert.strictEqual(inv.rows[0].reserved_quantity, 1);
  } finally {
    await pool.end();
  }
});

test('Concurrent reservations: inventory reserved_quantity never exceeds quantity', { skip: !PG_URI }, async () => {
  const pool = getPool();
  try {
    await pool.query(`UPDATE inventory SET quantity = 5, reserved_quantity = 0 WHERE offer_id = $1 AND location_id = $2`, [OFFER_ID_1_UNIT, LOCATION_ID_WAREHOUSE]);

    const promises = Array.from({ length: 10 }, (_, i) => reserveOneUnit(pool, USER_IDS[i % USER_IDS.length], `req-batch-${i}`));
    const results = await Promise.all(promises);

    const successCount = results.filter(r => r.success).length;
    assert.ok(successCount <= 5, `At most 5 reservations should succeed, got ${successCount}`);

    const inv = await pool.query(`SELECT quantity, reserved_quantity FROM inventory WHERE offer_id = $1 AND location_id = $2`, [OFFER_ID_1_UNIT, LOCATION_ID_WAREHOUSE]);
    assert.strictEqual(inv.rows[0].reserved_quantity, successCount);
    assert.ok(inv.rows[0].reserved_quantity <= inv.rows[0].quantity, 'reserved_quantity must not exceed quantity');
  } finally {
    await pool.end();
  }
});

test('Concurrent reservations: failed attempts leave no orphaned reservations', { skip: !PG_URI }, async () => {
  const pool = getPool();
  try {
    await pool.query(`UPDATE inventory SET quantity = 1, reserved_quantity = 0 WHERE offer_id = $1 AND location_id = $2`, [OFFER_ID_1_UNIT, LOCATION_ID_WAREHOUSE]);

    const promises = USER_IDS.map((userId, i) => reserveOneUnit(pool, userId, `req-orphan-${i}`));
    await Promise.all(promises);

    const res = await pool.query(`SELECT COUNT(*) FROM reservations WHERE offer_id = $1 AND status = 'reserved'`, [OFFER_ID_1_UNIT]);
    assert.strictEqual(parseInt(res.rows[0].count), 1, 'Only one reservation row should exist');
  } finally {
    await pool.end();
  }
});